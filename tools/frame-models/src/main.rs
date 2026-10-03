//! frame-models: extract the Steam Frame controller render models from the
//! OpenXR runtime for IWFDK.
//!
//! WebXR pages cannot reach the runtime's render models (XR_EXT_render_model),
//! so this runs natively on the headset, saves the controller GLBs, and records
//! how the runtime animates each model node while the user exercises every
//! control. `frame-controller-models.json` then lets IWFDK animate the real
//! models from WebXR gamepad values.
//!
//! Usage:
//!   frame-models [--out DIR] [--seconds N] [--rest N]
//!   frame-models calibrate DIR     re-run calibration on DIR/recording.json

mod actions;
mod calibrate;
mod loader;
mod output;
mod render_model;
mod vulkan;

use actions::{FRAME_EXTENSION, FrameActions, HANDS};
use calibrate::Sample;
use openxr as xr;
use output::{HandRecording, Recording, RuntimeInfo};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

struct Args {
    out: PathBuf,
    seconds: f64,
    rest: f64,
}

fn usage() -> ! {
    eprintln!(
        "usage: frame-models [--out DIR] [--seconds N] [--rest N]\n       frame-models calibrate DIR"
    );
    std::process::exit(2)
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let result = if argv.first().map(String::as_str) == Some("calibrate") {
        let dir = argv.get(1).map(PathBuf::from).unwrap_or_else(|| usage());
        calibrate_dir(&dir)
    } else {
        let mut args = Args {
            out: std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_default()
                .join("iwfdk-frame-models"),
            seconds: 90.0,
            rest: 3.0,
        };
        let mut it = argv.iter();
        while let Some(a) = it.next() {
            let mut value = || it.next().cloned().unwrap_or_else(|| usage());
            match a.as_str() {
                "--out" => args.out = PathBuf::from(value()),
                "--seconds" => args.seconds = value().parse().unwrap_or_else(|_| usage()),
                "--rest" => args.rest = value().parse().unwrap_or_else(|_| usage()),
                _ => usage(),
            }
        }
        record(&args)
    };
    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn calibrate_dir(dir: &Path) -> Result<(), String> {
    let rec = output::read_recording(dir)?;
    let models = output::models_from_recording(&rec)?;
    output::write_json(&dir.join(output::MODELS_FILE), &models)?;
    print!("{}", output::summary(&models));
    println!("wrote {}", dir.join(output::MODELS_FILE).display());
    Ok(())
}

fn xe(what: &'static str) -> impl Fn(xr::sys::Result) -> String {
    move |r| format!("{what}: XR_{r:?}")
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum Phase {
    /// Waiting for both controller models.
    Loading,
    /// Controls released, to capture rest poses.
    Rest,
    /// The user presses, pulls and tilts everything.
    Exercise,
    Done,
}

struct HandState {
    model: render_model::Model,
    space: xr::Space,
    grip: xr::Space,
    node_names: Vec<String>,
    samples: Vec<Sample>,
}

fn record(args: &Args) -> Result<(), String> {
    let manifest = loader::find_active_runtime(&loader::SearchEnv::from_process())?;
    println!("runtime manifest: {}", manifest.manifest_path);
    let loaded = loader::load_runtime(&manifest)?;
    println!(
        "negotiated loader interface {}, API {}",
        loaded.runtime_interface_version, loaded.runtime_api_version
    );
    let entry = loaded.entry;

    let avail = entry
        .enumerate_extensions()
        .map_err(xe("xrEnumerateInstanceExtensionProperties"))?;
    let has_frame = avail.other.iter().any(|n| {
        n.strip_suffix(b"\0").unwrap_or(n) == &FRAME_EXTENSION[..FRAME_EXTENSION.len() - 1]
    });
    let mut missing = Vec::new();
    if !avail.khr_vulkan_enable2 {
        missing.push("XR_KHR_vulkan_enable2");
    }
    if !avail.ext_render_model {
        missing.push("XR_EXT_render_model");
    }
    if !avail.ext_interaction_render_model {
        missing.push("XR_EXT_interaction_render_model");
    }
    if !avail.ext_uuid {
        missing.push("XR_EXT_uuid");
    }
    if !has_frame {
        missing.push("XR_VALVE_frame_controller_interaction");
    }
    if !missing.is_empty() {
        return Err(format!(
            "the active runtime lacks {} (this needs SteamVR on a Steam Frame)",
            missing.join(", ")
        ));
    }
    let mut enabled = xr::ExtensionSet::default();
    enabled.khr_vulkan_enable2 = true;
    enabled.ext_render_model = true;
    enabled.ext_interaction_render_model = true;
    enabled.ext_uuid = true;
    enabled.other.push(FRAME_EXTENSION.to_vec());

    let app = xr::ApplicationInfo {
        application_name: "iwfdk-frame-models",
        application_version: 1,
        engine_name: "iwfdk",
        engine_version: 1,
        api_version: xr::Version::new(1, 0, 0),
    };
    let instance = entry
        .create_instance(&app, &enabled, &[], &())
        .map_err(xe("xrCreateInstance"))?;
    let props = instance
        .properties()
        .map_err(xe("xrGetInstanceProperties"))?;
    let runtime = RuntimeInfo {
        name: props.runtime_name.clone(),
        version: props.runtime_version.to_string(),
    };
    println!("runtime: {} {}", runtime.name, runtime.version);
    let system = instance
        .system(xr::FormFactor::HEAD_MOUNTED_DISPLAY)
        .map_err(|r| {
            format!("xrGetSystem: XR_{r:?} (is SteamVR running and the headset awake?)")
        })?;
    let blend = *instance
        .enumerate_environment_blend_modes(system, xr::ViewConfigurationType::PRIMARY_STEREO)
        .map_err(xe("xrEnumerateEnvironmentBlendModes"))?
        .first()
        .ok_or("no environment blend modes")?;

    let actions = FrameActions::new(&instance)?;
    let api = render_model::RenderModelApi::new(&instance)?;
    let vulkan = vulkan::VulkanDevice::new(&instance, system)?;
    let (session, mut waiter, mut stream) =
        unsafe { instance.create_session::<xr::Vulkan>(system, &vulkan.create_info) }
            .map_err(xe("xrCreateSession"))?;
    session
        .attach_action_sets(&[&actions.set])
        .map_err(xe("xrAttachSessionActionSets"))?;
    let grip_space = |h: usize| {
        actions
            .grip
            .create_space(&session, actions.hand_paths[h], xr::Posef::IDENTITY)
            .map_err(xe("xrCreateActionSpace"))
    };

    std::fs::create_dir_all(&args.out).map_err(|e| format!("{}: {e}", args.out.display()))?;
    println!(
        "\nPut the headset on and hold both controllers.\n\
         1. One buzz: keep every control released for {:.0} s.\n\
         2. Long buzz: pull both triggers and grips fully, press every button\n\
            (A B X Y, menu, view, D-pad, shoulders, stick clicks) and roll\n\
            both sticks around their full circle a few times.\n\
         3. Two buzzes: done. Recording stops by itself once everything has\n\
            been seen, or after {:.0} s.\n",
        args.rest, args.seconds
    );

    let mut hands: [Option<HandState>; 2] = [None, None];
    let mut tried_ids: Vec<xr::sys::RenderModelIdEXT> = Vec::new();
    let mut phase = Phase::Loading;
    let mut phase_start = Instant::now();
    let mut last_report = Instant::now();
    let mut running = false;
    let mut focused = false;
    let mut frame_count = 0u64;
    let mut event_buf = xr::EventDataBuffer::new();
    let channels = [actions::channels(0), actions::channels(1)];

    'main: loop {
        while let Some(event) = instance
            .poll_event(&mut event_buf)
            .map_err(xe("xrPollEvent"))?
        {
            match event {
                xr::Event::SessionStateChanged(e) => match e.state() {
                    xr::SessionState::READY => {
                        session
                            .begin(xr::ViewConfigurationType::PRIMARY_STEREO)
                            .map_err(xe("xrBeginSession"))?;
                        running = true;
                    }
                    xr::SessionState::FOCUSED => focused = true,
                    xr::SessionState::VISIBLE => focused = false,
                    xr::SessionState::STOPPING => {
                        session.end().map_err(xe("xrEndSession"))?;
                        running = false;
                    }
                    xr::SessionState::EXITING | xr::SessionState::LOSS_PENDING => break 'main,
                    _ => {}
                },
                xr::Event::InstanceLossPending(_) => break 'main,
                _ => {}
            }
        }
        if !running {
            std::thread::sleep(Duration::from_millis(10));
            continue;
        }

        let state = waiter.wait().map_err(xe("xrWaitFrame"))?;
        stream.begin().map_err(xe("xrBeginFrame"))?;
        let time = state.predicted_display_time;
        frame_count += 1;

        if focused && phase != Phase::Done {
            session
                .sync_actions(&[(&actions.set).into()])
                .map_err(xe("xrSyncActions"))?;

            // Models appear once bindings are active; look for new ones
            // about twice a second until both hands have one.
            if hands.iter().any(Option::is_none) && frame_count % 45 == 1 {
                for id in api.interaction_ids(session.as_raw())? {
                    if tried_ids.contains(&id) {
                        continue;
                    }
                    let handle = api.create(session.as_raw(), id)?;
                    let paths = api.subaction_paths(handle)?;
                    let hand = (0..2).find(|&h| paths.contains(&actions.hand_paths[h]));
                    match hand {
                        Some(h) if hands[h].is_none() => {
                            tried_ids.push(id);
                            let model = api.load(session.as_raw(), handle)?;
                            println!(
                                "{} controller model: {} KiB, {} animatable nodes",
                                HANDS[h],
                                model.glb.len() / 1024,
                                model.node_names.len()
                            );
                            let space = unsafe {
                                xr::Space::reference_from_raw(session.clone(), model.space)
                            };
                            hands[h] = Some(HandState {
                                node_names: model.node_names.clone(),
                                model,
                                space,
                                grip: grip_space(h)?,
                                samples: Vec::new(),
                            });
                        }
                        // Not (yet) associated with a hand: retry later.
                        None => api.destroy(handle),
                        Some(_) => {
                            tried_ids.push(id);
                            api.destroy(handle);
                        }
                    }
                }
                if hands.iter().all(Option::is_some) {
                    phase = Phase::Rest;
                    phase_start = Instant::now();
                    actions.buzz(&session, 0.2);
                    println!("rest: keep every control released");
                }
            }

            if matches!(phase, Phase::Rest | Phase::Exercise) {
                let t0 = phase_start.elapsed().as_secs_f64();
                for (h, hs) in hands.iter_mut().enumerate() {
                    let Some(hs) = hs.as_mut() else {
                        continue;
                    };
                    let nodes = api.state(&hs.model, time)?;
                    let grip_from_model = hs
                        .space
                        .locate(&hs.grip, time)
                        .ok()
                        .filter(|l| {
                            l.location_flags.contains(
                                xr::SpaceLocationFlags::POSITION_TRACKED
                                    | xr::SpaceLocationFlags::ORIENTATION_TRACKED,
                            )
                        })
                        .map(|l| render_model::pose_from_xr(&l.pose));
                    hs.samples.push(Sample {
                        t: if phase == Phase::Rest {
                            t0
                        } else {
                            args.rest + t0
                        },
                        channels: actions.read(&session, h),
                        nodes,
                        grip_from_model,
                    });
                }
            }

            match phase {
                Phase::Rest if phase_start.elapsed().as_secs_f64() >= args.rest => {
                    phase = Phase::Exercise;
                    phase_start = Instant::now();
                    actions.buzz(&session, 0.8);
                    println!("go: press, pull and tilt everything");
                }
                Phase::Exercise => {
                    let elapsed = phase_start.elapsed().as_secs_f64();
                    let missing: Vec<String> = (0..2)
                        .flat_map(|h| {
                            let hs = hands[h].as_ref().unwrap();
                            calibrate::missing_coverage(&channels[h], &hs.samples)
                                .into_iter()
                                .map(move |m| format!("{}:{m}", HANDS[h]))
                        })
                        .collect();
                    if last_report.elapsed() >= Duration::from_secs(3) {
                        last_report = Instant::now();
                        println!(
                            "  {:>3.0} s, still to do: {}",
                            elapsed,
                            if missing.is_empty() {
                                "nothing".into()
                            } else {
                                missing.join(" ")
                            }
                        );
                    }
                    if (missing.is_empty() && elapsed >= 10.0) || elapsed >= args.seconds {
                        phase = Phase::Done;
                        actions.buzz(&session, 0.15);
                        std::thread::sleep(Duration::from_millis(250));
                        actions.buzz(&session, 0.15);
                        println!("done");
                    }
                }
                _ => {}
            }
        }

        stream.end(time, blend, &[]).map_err(xe("xrEndFrame"))?;
        if phase == Phase::Done {
            break;
        }
    }

    let mut rec = Recording {
        format: output::FORMAT.into(),
        version: output::VERSION,
        runtime,
        hands: BTreeMap::new(),
    };
    for (h, hs) in hands.into_iter().enumerate() {
        let Some(HandState {
            model,
            space,
            grip,
            node_names,
            samples,
        }) = hs
        else {
            continue;
        };
        drop((space, grip));
        api.destroy(model.handle);
        let asset = format!("{}.glb", HANDS[h]);
        let path = args.out.join(&asset);
        std::fs::write(&path, &model.glb)
            .map_err(|e| format!("writing {}: {e}", path.display()))?;
        rec.hands.insert(
            HANDS[h].into(),
            HandRecording {
                asset,
                channels: channels[h].clone(),
                node_names,
                samples,
            },
        );
    }
    if rec.hands.is_empty() {
        return Err("no controller models were found; are both controllers on?".into());
    }
    output::write_json(&args.out.join(output::RECORDING_FILE), &rec)?;
    calibrate_dir(&args.out)?;
    drop(session);
    drop(vulkan);
    Ok(())
}
