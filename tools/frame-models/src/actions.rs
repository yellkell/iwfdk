//! Actions for every Steam Frame controller input, bound with
//! `/interaction_profiles/valve/frame_controller_valve`, plus grip pose and
//! haptics. Channels are named by the WebXR component and property a page
//! reads, so the calibration maps straight onto the `valve-frame` profile.

use crate::calibrate::{Channel, Property};
use openxr as xr;

pub const FRAME_PROFILE: &str = "/interaction_profiles/valve/frame_controller_valve";
/// Not in the Khronos registry yet; SteamVR on the Steam Frame provides it.
pub const FRAME_EXTENSION: &[u8] = b"XR_VALVE_frame_controller_interaction\0";

pub const HANDS: [&str; 2] = ["left", "right"];

#[derive(Clone, Copy)]
enum Kind {
    Float,
    Bool,
    Vec2,
}

/// One OpenXR input: `(WebXR component, OpenXR component path, kind, hands)`
/// where hands is a mask, 1 = left, 2 = right. Paths follow Valve's
/// published profile (ValveSoftware/Unity, SteamFrameControllerProfile.cs).
const INPUTS: &[(&str, &str, Kind, u8)] = &[
    ("xr-standard-trigger", "trigger/value", Kind::Float, 3),
    ("xr-standard-trigger", "trigger/touch", Kind::Bool, 3),
    ("xr-standard-squeeze", "squeeze/value", Kind::Float, 3),
    ("xr-standard-squeeze", "squeeze/touch", Kind::Bool, 3),
    ("xr-standard-thumbstick", "thumbstick", Kind::Vec2, 3),
    ("xr-standard-thumbstick", "thumbstick/click", Kind::Bool, 3),
    ("xr-standard-thumbstick", "thumbstick/touch", Kind::Bool, 3),
    ("shoulder", "shoulder/click", Kind::Bool, 3),
    ("shoulder", "shoulder/touch", Kind::Bool, 3),
    ("a-button", "a/click", Kind::Bool, 2),
    ("a-button", "a/touch", Kind::Bool, 2),
    ("b-button", "b/click", Kind::Bool, 2),
    ("b-button", "b/touch", Kind::Bool, 2),
    ("x-button", "x/click", Kind::Bool, 2),
    ("x-button", "x/touch", Kind::Bool, 2),
    ("y-button", "y/click", Kind::Bool, 2),
    ("y-button", "y/touch", Kind::Bool, 2),
    ("menu", "menu/click", Kind::Bool, 2),
    ("menu", "menu/touch", Kind::Bool, 2),
    ("dpad-up", "dpad_up/click", Kind::Bool, 1),
    ("dpad-up", "dpad_up/touch", Kind::Bool, 1),
    ("dpad-down", "dpad_down/click", Kind::Bool, 1),
    ("dpad-down", "dpad_down/touch", Kind::Bool, 1),
    ("dpad-left", "dpad_left/click", Kind::Bool, 1),
    ("dpad-left", "dpad_left/touch", Kind::Bool, 1),
    ("dpad-right", "dpad_right/click", Kind::Bool, 1),
    ("dpad-right", "dpad_right/touch", Kind::Bool, 1),
    ("view", "view/click", Kind::Bool, 1),
    ("view", "view/touch", Kind::Bool, 1),
];

fn property(path: &str, kind: Kind) -> Property {
    match kind {
        Kind::Float => Property::Value,
        Kind::Vec2 => Property::X,
        Kind::Bool if path.ends_with("/touch") => Property::Touched,
        Kind::Bool => Property::Pressed,
    }
}

/// Channels recorded for one hand, in sample order.
pub fn channels(hand: usize) -> Vec<Channel> {
    let mut out = Vec::new();
    for &(component, path, kind, mask) in INPUTS {
        if mask & (1 << hand) == 0 {
            continue;
        }
        out.push(Channel {
            component: component.into(),
            property: property(path, kind),
        });
        if let Kind::Vec2 = kind {
            out.push(Channel {
                component: component.into(),
                property: Property::Y,
            });
        }
    }
    out
}

enum Typed {
    Float(xr::Action<f32>),
    Bool(xr::Action<bool>),
    Vec2(xr::Action<xr::Vector2f>),
}

pub struct FrameActions {
    pub set: xr::ActionSet,
    inputs: Vec<(Typed, u8)>,
    pub grip: xr::Action<xr::Posef>,
    haptic: xr::Action<xr::Haptic>,
    pub hand_paths: [xr::Path; 2],
}

impl FrameActions {
    pub fn new(instance: &xr::Instance) -> Result<FrameActions, String> {
        let set = instance
            .create_action_set("frame_models", "Frame model capture", 0)
            .map_err(e("xrCreateActionSet"))?;
        let hand_paths = [
            instance
                .string_to_path("/user/hand/left")
                .map_err(e("path"))?,
            instance
                .string_to_path("/user/hand/right")
                .map_err(e("path"))?,
        ];
        let mut inputs = Vec::new();
        let mut bindings_paths = Vec::new();
        for &(_, path, kind, mask) in INPUTS {
            let name = path.replace('/', "_");
            let typed = match kind {
                Kind::Float => Typed::Float(
                    set.create_action(&name, &name, &hand_paths)
                        .map_err(e("xrCreateAction"))?,
                ),
                Kind::Bool => Typed::Bool(
                    set.create_action(&name, &name, &hand_paths)
                        .map_err(e("xrCreateAction"))?,
                ),
                Kind::Vec2 => Typed::Vec2(
                    set.create_action(&name, &name, &hand_paths)
                        .map_err(e("xrCreateAction"))?,
                ),
            };
            for (h, side) in HANDS.iter().enumerate() {
                if mask & (1 << h) != 0 {
                    bindings_paths.push((inputs.len(), format!("/user/hand/{side}/input/{path}")));
                }
            }
            inputs.push((typed, mask));
        }
        let grip = set
            .create_action("grip_pose", "Grip pose", &hand_paths)
            .map_err(e("xrCreateAction"))?;
        let haptic = set
            .create_action("haptic", "Haptic", &hand_paths)
            .map_err(e("xrCreateAction"))?;

        let mut bindings = Vec::new();
        for (i, path) in &bindings_paths {
            let p = instance.string_to_path(path).map_err(e("path"))?;
            bindings.push(match &inputs[*i].0 {
                Typed::Float(a) => xr::Binding::new(a, p),
                Typed::Bool(a) => xr::Binding::new(a, p),
                Typed::Vec2(a) => xr::Binding::new(a, p),
            });
        }
        for side in HANDS {
            let grip_path = instance
                .string_to_path(&format!("/user/hand/{side}/input/grip/pose"))
                .map_err(e("path"))?;
            let haptic_path = instance
                .string_to_path(&format!("/user/hand/{side}/output/haptic"))
                .map_err(e("path"))?;
            bindings.push(xr::Binding::new(&grip, grip_path));
            bindings.push(xr::Binding::new(&haptic, haptic_path));
        }
        let profile = instance.string_to_path(FRAME_PROFILE).map_err(e("path"))?;
        instance
            .suggest_interaction_profile_bindings(profile, &bindings)
            .map_err(e("xrSuggestInteractionProfileBindings (Frame profile)"))?;
        Ok(FrameActions {
            set,
            inputs,
            grip,
            haptic,
            hand_paths,
        })
    }

    /// Current values of `channels(hand)`, in the same order.
    pub fn read<G>(&self, session: &xr::Session<G>, hand: usize) -> Vec<f32> {
        let sub = self.hand_paths[hand];
        let mut out = Vec::new();
        for (typed, mask) in &self.inputs {
            if mask & (1 << hand) == 0 {
                continue;
            }
            match typed {
                Typed::Float(a) => out.push(
                    a.state(session, sub)
                        .map(|s| s.current_state)
                        .unwrap_or(0.0),
                ),
                Typed::Bool(a) => out.push(
                    a.state(session, sub)
                        .map(|s| if s.current_state { 1.0 } else { 0.0 })
                        .unwrap_or(0.0),
                ),
                Typed::Vec2(a) => {
                    let v = a
                        .state(session, sub)
                        .map(|s| s.current_state)
                        .unwrap_or(xr::Vector2f { x: 0.0, y: 0.0 });
                    out.push(v.x);
                    out.push(v.y);
                }
            }
        }
        out
    }

    /// Haptic cue on both controllers.
    pub fn buzz<G>(&self, session: &xr::Session<G>, seconds: f32) {
        let v = xr::HapticVibration::new()
            .amplitude(0.6)
            .frequency(xr::FREQUENCY_UNSPECIFIED)
            .duration(xr::Duration::from_nanos((seconds * 1e9) as i64));
        for p in self.hand_paths {
            let _ = self.haptic.apply_feedback(session, p, &v);
        }
    }
}

fn e(what: &'static str) -> impl Fn(xr::sys::Result) -> String {
    move |r| format!("{what}: XR_{r:?}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_lists_follow_the_hardware() {
        let left = channels(0);
        let right = channels(1);
        let has = |list: &[Channel], c: &str, p: Property| {
            list.iter().any(|x| x.component == c && x.property == p)
        };
        for list in [&left, &right] {
            assert!(has(list, "xr-standard-trigger", Property::Value));
            assert!(has(list, "xr-standard-thumbstick", Property::X));
            assert!(has(list, "xr-standard-thumbstick", Property::Y));
            assert!(has(list, "shoulder", Property::Pressed));
        }
        assert!(has(&right, "a-button", Property::Pressed));
        assert!(has(&right, "menu", Property::Touched));
        assert!(!has(&left, "a-button", Property::Pressed));
        assert!(has(&left, "dpad-up", Property::Pressed));
        assert!(has(&left, "view", Property::Pressed));
        assert!(!has(&right, "view", Property::Pressed));
        // Every channel is unique per hand.
        for list in [&left, &right] {
            for (i, a) in list.iter().enumerate() {
                assert!(!list[i + 1..].contains(a), "{a:?}");
            }
        }
    }

    #[test]
    fn action_names_are_valid() {
        for &(_, path, _, _) in INPUTS {
            let name = path.replace('/', "_");
            assert!(
                name.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "{name}"
            );
        }
        assert_eq!(FRAME_EXTENSION.last(), Some(&0));
    }
}
