//! Turns a recording of controller input and render-model node states into
//! a description of how each animatable node follows the input.
//!
//! The OpenXR runtime animates a render model by reporting a local pose and a
//! visibility flag per animatable node every frame (XR_EXT_render_model). A
//! WebXR page cannot ask the runtime for those, only for gamepad values, so
//! this recovers the mapping offline: while the user exercises every control,
//! each node's motion is correlated with every input channel, and the poses at
//! rest and at full deflection are averaged from the matching frames.

use glam::{Quat, Vec3};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A local node pose (relative to the parent node), or a model pose.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pose {
    pub position: [f32; 3],
    /// Quaternion `[x, y, z, w]`.
    pub orientation: [f32; 4],
}

impl Pose {
    #[cfg(test)]
    pub const IDENTITY: Pose = Pose {
        position: [0.0; 3],
        orientation: [0.0, 0.0, 0.0, 1.0],
    };

    pub fn new(p: Vec3, q: Quat) -> Pose {
        Pose {
            position: p.to_array(),
            orientation: q.normalize().to_array(),
        }
    }

    pub fn p(&self) -> Vec3 {
        Vec3::from_array(self.position)
    }

    pub fn q(&self) -> Quat {
        Quat::from_array(self.orientation).normalize()
    }
}

/// What a channel reports, named after the WebXR `GamepadButton` / axes
/// properties the page will read.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Property {
    /// Analog 0..1 (trigger, squeeze).
    Value,
    /// Button pressed, 0 or 1.
    Pressed,
    /// Capacitive touch, 0 or 1.
    Touched,
    /// Thumbstick x, -1 (left) .. 1 (right).
    X,
    /// Thumbstick y in OpenXR convention: -1 (back) .. 1 (forward).
    Y,
}

/// One recorded input channel: a WebXR component id plus property.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub component: String,
    pub property: Property,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct NodeSample {
    pub pose: Pose,
    pub visible: bool,
}

/// One frame of one controller.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// Seconds since recording started.
    pub t: f64,
    /// Values in the order of the recording's channel list.
    pub channels: Vec<f32>,
    /// States in the order of the asset's animatable node names.
    pub nodes: Vec<NodeSample>,
    /// The render model's origin located in the grip space, when tracked.
    pub grip_from_model: Option<Pose>,
}

/// How one node follows the input.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Animation {
    /// Interpolate between `rest` (input 0) and `pressed` (input 1).
    #[serde(rename_all = "camelCase")]
    Button {
        node: String,
        component: String,
        property: Property,
        rest: Pose,
        pressed: Pose,
        /// Correlation of the node's motion with the input (diagnostic).
        confidence: f32,
    },
    /// Thumbstick tilt: poses at full deflection in each direction (OpenXR
    /// convention, `up` = pushed forward). Missing directions were not
    /// reached during the recording.
    #[serde(rename_all = "camelCase")]
    Stick {
        node: String,
        component: String,
        rest: Pose,
        left: Option<Pose>,
        right: Option<Pose>,
        up: Option<Pose>,
        down: Option<Pose>,
        confidence: f32,
    },
    /// Node shown or hidden with an input (touch indicators and the like).
    #[serde(rename_all = "camelCase")]
    Visibility {
        node: String,
        component: String,
        property: Property,
        /// Visible while the input is active (true) or inactive (false).
        visible_when_active: bool,
        confidence: f32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandCalibration {
    pub animations: Vec<Animation>,
    /// Node visibility when every input is at rest.
    pub visible_at_rest: BTreeMap<String, bool>,
    /// Nodes that never moved or changed visibility, or that moved without
    /// correlating with any input.
    pub unmapped_nodes: Vec<String>,
    /// Mean model pose in the grip space, which a page applies to the model
    /// (WebXR exposes grip poses, not render model spaces).
    pub grip_from_model: Option<Pose>,
    /// Spread of the model position in the grip space, metres. A rigid
    /// attachment stays well under a millimetre.
    pub grip_from_model_spread: Option<f32>,
    pub rest_samples: usize,
}

/// Distance of a pose from rest, in units where 2 mm or ~2.9° count as 1.
fn deviation(a: &Pose, rest: &Pose) -> f32 {
    let dp = (a.p() - rest.p()).length() / 0.002;
    let dq = a.q().angle_between(rest.q()) / 0.05;
    dp + dq
}

fn pearson(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n < 2 {
        return 0.0;
    }
    let ma = a[..n].iter().sum::<f32>() / n as f32;
    let mb = b[..n].iter().sum::<f32>() / n as f32;
    let (mut cov, mut va, mut vb) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..n {
        let (da, db) = (a[i] - ma, b[i] - mb);
        cov += da * db;
        va += da * da;
        vb += db * db;
    }
    if va <= f32::EPSILON || vb <= f32::EPSILON {
        0.0
    } else {
        cov / (va.sqrt() * vb.sqrt())
    }
}

/// Mean of poses; quaternions are sign-aligned to the first before summing.
pub fn mean_pose<'a>(poses: impl IntoIterator<Item = &'a Pose>) -> Option<Pose> {
    let mut n = 0usize;
    let mut p = Vec3::ZERO;
    let mut q_sum = glam::Vec4::ZERO;
    let mut first: Option<Quat> = None;
    for pose in poses {
        let q = pose.q();
        let reference = *first.get_or_insert(q);
        let v = glam::Vec4::from(q);
        q_sum += if v.dot(glam::Vec4::from(reference)) < 0.0 {
            -v
        } else {
            v
        };
        p += pose.p();
        n += 1;
    }
    (n > 0).then(|| Pose::new(p / n as f32, Quat::from_vec4(q_sum).normalize()))
}

/// Minimum frames that must agree before a pose is trusted.
const MIN_FRAMES: usize = 3;
/// Inputs below this count as at rest.
const REST: f32 = 0.05;
/// Inputs at or above this count as fully deflected.
const FULL: f32 = 0.95;
/// Thumbstick axis deflection that counts as a full push...
const STICK_FULL: f32 = 0.9;
/// ...while the other axis stays below this.
const STICK_CROSS: f32 = 0.3;
/// Minimum correlation for a mapping.
const MIN_MOTION_R: f32 = 0.5;
const MIN_VISIBILITY_R: f32 = 0.6;

/// Motion sources a node can follow.
enum Source {
    /// Index of a value or pressed channel.
    Scalar(usize),
    /// Indices of the x and y channels of one thumbstick.
    Stick {
        component: String,
        x: usize,
        y: usize,
    },
}

fn motion_sources(channels: &[Channel]) -> Vec<Source> {
    let mut out = Vec::new();
    for (i, c) in channels.iter().enumerate() {
        match c.property {
            Property::Value | Property::Pressed => out.push(Source::Scalar(i)),
            Property::X => {
                if let Some(y) = channels
                    .iter()
                    .position(|o| o.component == c.component && o.property == Property::Y)
                {
                    out.push(Source::Stick {
                        component: c.component.clone(),
                        x: i,
                        y,
                    });
                }
            }
            Property::Touched | Property::Y => {}
        }
    }
    out
}

fn source_signal(source: &Source, samples: &[Sample]) -> Vec<f32> {
    samples
        .iter()
        .map(|s| match source {
            Source::Scalar(i) => s.channels[*i].abs().min(1.0),
            Source::Stick { x, y, .. } => {
                let (x, y) = (s.channels[*x], s.channels[*y]);
                (x * x + y * y).sqrt().min(1.0)
            }
        })
        .collect()
}

/// Calibrate one controller. `samples` must all have `channels.len()` equal
/// to `channels.len()` and `nodes.len()` equal to `node_names.len()`.
pub fn calibrate(
    channels: &[Channel],
    node_names: &[String],
    samples: &[Sample],
) -> Result<HandCalibration, String> {
    for s in samples {
        if s.channels.len() != channels.len() || s.nodes.len() != node_names.len() {
            return Err("sample does not match the channel or node list".into());
        }
    }

    // Rest: every channel idle. Touch is allowed when nothing else rests
    // (a thumb resting on a capacitive stick is normal).
    let idle = |s: &Sample, include_touch: bool| {
        channels
            .iter()
            .zip(&s.channels)
            .all(|(c, v)| (!include_touch && c.property == Property::Touched) || v.abs() < REST)
    };
    let mut rest: Vec<&Sample> = samples.iter().filter(|s| idle(s, true)).collect();
    if rest.len() < MIN_FRAMES {
        rest = samples.iter().filter(|s| idle(s, false)).collect();
    }
    if rest.len() < MIN_FRAMES {
        return Err(format!(
            "only {} frames with every control released; hold still for a few seconds at the start",
            rest.len()
        ));
    }

    let sources = motion_sources(channels);
    let signals: Vec<Vec<f32>> = sources.iter().map(|s| source_signal(s, samples)).collect();

    let mut animations = Vec::new();
    let mut visible_at_rest = BTreeMap::new();
    let mut unmapped = Vec::new();

    for (n, name) in node_names.iter().enumerate() {
        let rest_pose = mean_pose(rest.iter().map(|s| &s.nodes[n].pose)).expect("rest frames");
        let rest_visible = rest.iter().filter(|s| s.nodes[n].visible).count() * 2 >= rest.len();
        visible_at_rest.insert(name.clone(), rest_visible);
        let mut mapped = false;

        // Motion.
        let dev: Vec<f32> = samples
            .iter()
            .map(|s| deviation(&s.nodes[n].pose, &rest_pose))
            .collect();
        if dev.iter().cloned().fold(0.0, f32::max) > 1.0 {
            let best = signals
                .iter()
                .enumerate()
                .map(|(i, sig)| (i, pearson(sig, &dev)))
                .max_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((i, r)) = best.filter(|(_, r)| *r >= MIN_MOTION_R) {
                match &sources[i] {
                    Source::Scalar(c) => {
                        // Frames at the top of the observed range, so a
                        // pull that passes 0.95 on its way to 1.0 does not
                        // drag the pose short of full deflection.
                        let top = samples.iter().map(|s| s.channels[*c]).fold(0.0, f32::max);
                        let cut = FULL.max(top - 0.01);
                        let full = samples
                            .iter()
                            .filter(|s| s.channels[*c] >= cut)
                            .map(|s| &s.nodes[n].pose);
                        let count = samples.iter().filter(|s| s.channels[*c] >= cut).count();
                        if top >= FULL && count >= MIN_FRAMES {
                            animations.push(Animation::Button {
                                node: name.clone(),
                                component: channels[*c].component.clone(),
                                property: channels[*c].property,
                                rest: rest_pose,
                                pressed: mean_pose(full).expect("frames"),
                                confidence: r,
                            });
                            mapped = true;
                        }
                    }
                    Source::Stick { component, x, y } => {
                        // For each direction keep the purest pushes: the
                        // frames whose deflection along the axis minus the
                        // deflection across it is near the best seen.
                        let at = |want_x: f32, want_y: f32| {
                            let score = |s: &Sample| {
                                let (sx, sy) = (s.channels[*x], s.channels[*y]);
                                if want_x != 0.0 {
                                    sx * want_x - sy.abs()
                                } else {
                                    sy * want_y - sx.abs()
                                }
                            };
                            let best = samples.iter().map(score).fold(f32::MIN, f32::max);
                            if best < STICK_FULL - STICK_CROSS {
                                return None;
                            }
                            let hits: Vec<&Pose> = samples
                                .iter()
                                .filter(|s| score(s) >= best - 0.02)
                                .map(|s| &s.nodes[n].pose)
                                .collect();
                            (hits.len() >= MIN_FRAMES)
                                .then(|| mean_pose(hits.iter().copied()))
                                .flatten()
                        };
                        animations.push(Animation::Stick {
                            node: name.clone(),
                            component: component.clone(),
                            rest: rest_pose,
                            left: at(-1.0, 0.0),
                            right: at(1.0, 0.0),
                            up: at(0.0, 1.0),
                            down: at(0.0, -1.0),
                            confidence: r,
                        });
                        mapped = true;
                    }
                }
            }
        }

        // Visibility.
        let vis: Vec<f32> = samples
            .iter()
            .map(|s| if s.nodes[n].visible { 1.0 } else { 0.0 })
            .collect();
        if vis.iter().any(|v| *v > 0.5) && vis.iter().any(|v| *v < 0.5) {
            let best = channels
                .iter()
                .enumerate()
                .map(|(c, _)| {
                    let active: Vec<f32> = samples
                        .iter()
                        .map(|s| if s.channels[c].abs() > 0.5 { 1.0 } else { 0.0 })
                        .collect();
                    (c, pearson(&active, &vis))
                })
                .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()));
            if let Some((c, r)) = best.filter(|(_, r)| r.abs() >= MIN_VISIBILITY_R) {
                animations.push(Animation::Visibility {
                    node: name.clone(),
                    component: channels[c].component.clone(),
                    property: channels[c].property,
                    visible_when_active: r > 0.0,
                    confidence: r.abs(),
                });
                mapped = true;
            }
        }

        if !mapped {
            unmapped.push(name.clone());
        }
    }

    let model_poses: Vec<&Pose> = samples
        .iter()
        .filter_map(|s| s.grip_from_model.as_ref())
        .collect();
    let grip_from_model = mean_pose(model_poses.iter().copied());
    let grip_from_model_spread = grip_from_model.map(|m| {
        model_poses
            .iter()
            .map(|p| (p.p() - m.p()).length())
            .fold(0.0, f32::max)
    });

    Ok(HandCalibration {
        animations,
        visible_at_rest,
        unmapped_nodes: unmapped,
        grip_from_model,
        grip_from_model_spread,
        rest_samples: rest.len(),
    })
}

/// Channels whose full range has not been seen yet, as `component.property`
/// (sticks need all four directions).
pub fn missing_coverage(channels: &[Channel], samples: &[Sample]) -> Vec<String> {
    let mut out = Vec::new();
    for (i, c) in channels.iter().enumerate() {
        let max = samples
            .iter()
            .map(|s| s.channels[i])
            .fold(f32::MIN, f32::max);
        let min = samples
            .iter()
            .map(|s| s.channels[i])
            .fold(f32::MAX, f32::min);
        let done = match c.property {
            Property::X | Property::Y => max >= STICK_FULL && min <= -STICK_FULL,
            Property::Touched => true,
            Property::Value | Property::Pressed => max >= FULL,
        };
        if !done {
            out.push(format!("{}.{:?}", c.component, c.property).to_lowercase());
        }
    }
    out
}

/// A synthetic controller recording shared by the calibration and output
/// tests: the trigger rotates 20° about x, the stick tilts 15° per axis about
/// its pivot, A sinks 2.5 mm, a dot shows on A touch, the body never moves.
#[cfg(test)]
pub mod testdata {
    use super::*;

    pub fn ch(component: &str, property: Property) -> Channel {
        Channel {
            component: component.into(),
            property,
        }
    }

    pub fn channels() -> Vec<Channel> {
        vec![
            ch("xr-standard-trigger", Property::Value),
            ch("xr-standard-thumbstick", Property::X),
            ch("xr-standard-thumbstick", Property::Y),
            ch("a-button", Property::Pressed),
            ch("a-button", Property::Touched),
        ]
    }

    pub fn names() -> Vec<String> {
        ["trigger", "stick", "button_a", "a_touch_dot", "body"]
            .map(String::from)
            .to_vec()
    }

    /// A synthetic controller: the trigger rotates 20° about x, the stick
    /// tilts 15° per axis about its pivot, A sinks 2.5 mm, a dot shows on
    /// A touch, the body never moves.
    pub fn frame(t: f64, trigger: f32, sx: f32, sy: f32, a: f32, a_touch: f32) -> Sample {
        let trigger_pose = Pose::new(
            Vec3::new(0.0, -0.01, 0.03),
            Quat::from_rotation_x((20.0f32).to_radians() * trigger),
        );
        let stick_pose = Pose::new(
            Vec3::new(0.0, 0.01, 0.0),
            Quat::from_rotation_z(-(15.0f32).to_radians() * sx)
                * Quat::from_rotation_x(-(15.0f32).to_radians() * sy),
        );
        let a_pose = Pose::new(Vec3::new(0.01, 0.012 - 0.0025 * a, 0.0), Quat::IDENTITY);
        let node = |pose, visible| NodeSample { pose, visible };
        Sample {
            t,
            channels: vec![trigger, sx, sy, a, a_touch],
            nodes: vec![
                node(trigger_pose, true),
                node(stick_pose, true),
                node(a_pose, true),
                node(Pose::IDENTITY, a_touch > 0.5),
                node(Pose::new(Vec3::new(0.0, 0.0, 0.05), Quat::IDENTITY), true),
            ],
            grip_from_model: Some(Pose::new(
                Vec3::new(0.0, -0.02, 0.04),
                Quat::from_rotation_x(-0.3),
            )),
        }
    }

    /// Idle, then each control in turn, as a user would.
    pub fn session() -> Vec<Sample> {
        let mut s = Vec::new();
        let mut t = 0.0;
        let push = |s: &mut Vec<Sample>, f: Sample| s.push(f);
        for _ in 0..30 {
            push(&mut s, frame(t, 0.0, 0.0, 0.0, 0.0, 0.0));
            t += 0.011;
        }
        for i in 0..=40 {
            let v = (i as f32 / 20.0).min(2.0 - i as f32 / 20.0).clamp(0.0, 1.0);
            push(&mut s, frame(t, v, 0.0, 0.0, 0.0, 0.0));
            t += 0.011;
        }
        for _ in 0..10 {
            push(&mut s, frame(t, 1.0, 0.0, 0.0, 0.0, 0.0));
        }
        for i in 0..80 {
            let a = i as f32 / 80.0 * std::f32::consts::TAU;
            push(&mut s, frame(t, 0.0, a.cos(), a.sin(), 0.0, 1.0));
            t += 0.011;
        }
        for (x, y) in [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
            for _ in 0..5 {
                push(&mut s, frame(t, 0.0, x, y, 0.0, 1.0));
            }
        }
        for i in 0..40 {
            let touch = if i % 10 < 8 { 1.0 } else { 0.0 };
            let press = if (2..6).contains(&(i % 10)) { 1.0 } else { 0.0 };
            push(&mut s, frame(t, 0.0, 0.0, 0.0, press, touch));
            t += 0.011;
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::testdata::*;
    use super::*;

    fn find<'a>(c: &'a HandCalibration, node: &str) -> Vec<&'a Animation> {
        c.animations
            .iter()
            .filter(|a| match a {
                Animation::Button { node: n, .. }
                | Animation::Stick { node: n, .. }
                | Animation::Visibility { node: n, .. } => n == node,
            })
            .collect()
    }

    fn close(a: &Pose, b: &Pose) -> bool {
        (a.p() - b.p()).length() < 1e-4 && a.q().angle_between(b.q()) < 1e-3
    }

    #[test]
    fn maps_trigger_button_stick_and_touch_dot() {
        let samples = session();
        let c = calibrate(&channels(), &names(), &samples).unwrap();

        match find(&c, "trigger")[..] {
            [
                Animation::Button {
                    component,
                    property,
                    rest,
                    pressed,
                    ..
                },
            ] => {
                assert_eq!(component, "xr-standard-trigger");
                assert_eq!(*property, Property::Value);
                assert!(close(
                    rest,
                    &frame(0.0, 0.0, 0.0, 0.0, 0.0, 0.0).nodes[0].pose
                ));
                assert!(close(
                    pressed,
                    &frame(0.0, 1.0, 0.0, 0.0, 0.0, 0.0).nodes[0].pose
                ));
            }
            ref other => panic!("trigger: {other:?}"),
        }

        match find(&c, "stick")[..] {
            [
                Animation::Stick {
                    component,
                    left,
                    right,
                    up,
                    down,
                    ..
                },
            ] => {
                assert_eq!(component, "xr-standard-thumbstick");
                let pose = |x, y| frame(0.0, 0.0, x, y, 0.0, 0.0).nodes[1].pose;
                assert!(close(right.as_ref().unwrap(), &pose(1.0, 0.0)));
                assert!(close(left.as_ref().unwrap(), &pose(-1.0, 0.0)));
                assert!(close(up.as_ref().unwrap(), &pose(0.0, 1.0)));
                assert!(close(down.as_ref().unwrap(), &pose(0.0, -1.0)));
            }
            ref other => panic!("stick: {other:?}"),
        }

        match find(&c, "button_a")[..] {
            [
                Animation::Button {
                    component,
                    property,
                    pressed,
                    ..
                },
            ] => {
                assert_eq!(
                    (component.as_str(), *property),
                    ("a-button", Property::Pressed)
                );
                assert!((pressed.position[1] - 0.0095).abs() < 1e-5);
            }
            ref other => panic!("button_a: {other:?}"),
        }

        match find(&c, "a_touch_dot")[..] {
            [
                Animation::Visibility {
                    component,
                    property,
                    visible_when_active,
                    ..
                },
            ] => {
                assert_eq!(component, "a-button");
                assert_eq!(*property, Property::Touched);
                assert!(*visible_when_active);
            }
            ref other => panic!("a_touch_dot: {other:?}"),
        }

        assert_eq!(c.unmapped_nodes, vec!["body".to_string()]);
        assert_eq!(c.visible_at_rest.get("a_touch_dot"), Some(&false));
        let m = c.grip_from_model.unwrap();
        assert!((m.p() - Vec3::new(0.0, -0.02, 0.04)).length() < 1e-5);
        assert!(c.grip_from_model_spread.unwrap() < 1e-5);
        assert!(c.rest_samples >= 30);
    }

    #[test]
    fn needs_rest_frames() {
        let samples: Vec<Sample> = (0..20)
            .map(|i| frame(i as f64, 1.0, 0.0, 0.0, 0.0, 0.0))
            .collect();
        assert!(calibrate(&channels(), &names(), &samples).is_err());
    }

    #[test]
    fn rejects_mismatched_samples() {
        let mut s = session();
        s[3].channels.pop();
        assert!(calibrate(&channels(), &names(), &s).is_err());
    }

    #[test]
    fn coverage_reports_unexercised_controls() {
        let samples = session();
        assert!(missing_coverage(&channels(), &samples).is_empty());
        let partial: Vec<Sample> = samples[..60].to_vec();
        let missing = missing_coverage(&channels(), &partial);
        assert!(missing.contains(&"xr-standard-thumbstick.x".to_string()));
        assert!(missing.contains(&"a-button.pressed".to_string()));
        assert!(!missing.iter().any(|m| m.ends_with(".touched")));
    }

    #[test]
    fn mean_pose_handles_quaternion_sign() {
        let q = Quat::from_rotation_y(0.4);
        let a = Pose::new(Vec3::X, q);
        let mut b = Pose::new(Vec3::Y, q);
        b.orientation = (-q).to_array();
        let m = mean_pose([&a, &b]).unwrap();
        assert!(m.q().angle_between(q) < 1e-5);
        assert!((m.p() - Vec3::new(0.5, 0.5, 0.0)).length() < 1e-6);
    }
}
