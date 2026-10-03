//! Files written next to the extracted models:
//!
//! - `left.glb`, `right.glb`: the runtime's render model assets, verbatim.
//! - `recording.json`: the raw capture, so calibration can be re-run offline
//!   (`frame-models calibrate <dir>`) without the headset.
//! - `frame-controller-models.json`: what IWFDK loads (see
//!   `packages/xr-input/src/frame/models.ts`).

use crate::calibrate::{self, Channel, HandCalibration, Sample};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const FORMAT: &str = "iwfdk-frame-controller-models";
pub const VERSION: u32 = 1;
pub const MODELS_FILE: &str = "frame-controller-models.json";
pub const RECORDING_FILE: &str = "recording.json";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandRecording {
    pub asset: String,
    pub channels: Vec<Channel>,
    pub node_names: Vec<String>,
    pub samples: Vec<Sample>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub format: String,
    pub version: u32,
    pub runtime: RuntimeInfo,
    pub hands: BTreeMap<String, HandRecording>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandModel {
    pub asset: String,
    pub node_names: Vec<String>,
    #[serde(flatten)]
    pub calibration: HandCalibration,
    /// Controls never fully exercised during the capture; their animation is
    /// missing or partial.
    pub missing_coverage: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Models {
    pub format: String,
    pub version: u32,
    pub runtime: RuntimeInfo,
    pub hands: BTreeMap<String, HandModel>,
}

/// Calibrate every hand of a recording.
pub fn models_from_recording(rec: &Recording) -> Result<Models, String> {
    let mut hands = BTreeMap::new();
    for (hand, r) in &rec.hands {
        let calibration = calibrate::calibrate(&r.channels, &r.node_names, &r.samples)
            .map_err(|e| format!("{hand}: {e}"))?;
        hands.insert(
            hand.clone(),
            HandModel {
                asset: r.asset.clone(),
                node_names: r.node_names.clone(),
                calibration,
                missing_coverage: calibrate::missing_coverage(&r.channels, &r.samples),
            },
        );
    }
    Ok(Models {
        format: FORMAT.into(),
        version: VERSION,
        runtime: rec.runtime.clone(),
        hands,
    })
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("writing {}: {e}", path.display()))
}

pub fn read_recording(dir: &Path) -> Result<Recording, String> {
    let path = dir.join(RECORDING_FILE);
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("reading {}: {e}", path.display()))?;
    let rec: Recording =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    if rec.format != FORMAT || rec.version != VERSION {
        return Err(format!(
            "{}: not a version {VERSION} recording",
            path.display()
        ));
    }
    Ok(rec)
}

/// Human-readable summary for the terminal.
pub fn summary(models: &Models) -> String {
    let mut out = String::new();
    for (hand, m) in &models.hands {
        let c = &m.calibration;
        out.push_str(&format!(
            "{hand}: {} animatable nodes, {} mapped animations, {} unmapped\n",
            m.node_names.len(),
            c.animations.len(),
            c.unmapped_nodes.len()
        ));
        for a in &c.animations {
            let line = match a {
                calibrate::Animation::Button {
                    node,
                    component,
                    property,
                    confidence,
                    ..
                } => {
                    format!("  {node:<28} <- {component}.{property:?} (r={confidence:.2})")
                }
                calibrate::Animation::Stick {
                    node,
                    component,
                    left,
                    right,
                    up,
                    down,
                    confidence,
                    ..
                } => {
                    let dirs = [("left", left), ("right", right), ("up", up), ("down", down)]
                        .iter()
                        .filter(|(_, p)| p.is_some())
                        .map(|(d, _)| *d)
                        .collect::<Vec<_>>()
                        .join("/");
                    format!("  {node:<28} <- {component} tilt [{dirs}] (r={confidence:.2})")
                }
                calibrate::Animation::Visibility {
                    node,
                    component,
                    property,
                    visible_when_active,
                    confidence,
                } => {
                    format!(
                        "  {node:<28} <- {component}.{property:?} {} (r={confidence:.2})",
                        if *visible_when_active {
                            "shows"
                        } else {
                            "hides"
                        }
                    )
                }
            };
            out.push_str(&line.to_lowercase());
            out.push('\n');
        }
        if !c.unmapped_nodes.is_empty() {
            out.push_str(&format!("  unmapped: {}\n", c.unmapped_nodes.join(", ")));
        }
        match (c.grip_from_model, c.grip_from_model_spread) {
            (Some(_), Some(spread)) if spread > 0.002 => out.push_str(&format!(
                "  warning: model moves {:.1} mm relative to the grip pose\n",
                spread * 1000.0
            )),
            (None, _) => {
                out.push_str("  warning: model space never located against the grip pose\n")
            }
            _ => {}
        }
        if !m.missing_coverage.is_empty() {
            out.push_str(&format!(
                "  not fully exercised: {}\n",
                m.missing_coverage.join(", ")
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calibrate::testdata;

    const FIXTURE: &str = "../../packages/xr-input/tests/fixtures/frame-controller-models.json";

    fn recording() -> Recording {
        let mut hands = BTreeMap::new();
        for hand in ["left", "right"] {
            hands.insert(
                hand.to_string(),
                HandRecording {
                    asset: format!("{hand}.glb"),
                    channels: testdata::channels(),
                    node_names: testdata::names(),
                    samples: testdata::session(),
                },
            );
        }
        Recording {
            format: FORMAT.into(),
            version: VERSION,
            runtime: RuntimeInfo {
                name: "synthetic".into(),
                version: "0.0.0".into(),
            },
            hands,
        }
    }

    /// The models file IWFDK parses (packages/xr-input/src/frame/models.ts)
    /// is generated from this crate's output, so the two cannot drift. Run
    /// with UPDATE_FIXTURES=1 to regenerate after changing the format.
    #[test]
    fn models_file_matches_the_web_fixture() {
        let models = models_from_recording(&recording()).unwrap();
        let text = serde_json::to_string_pretty(&models).unwrap() + "\n";
        if std::env::var_os("UPDATE_FIXTURES").is_some() {
            std::fs::create_dir_all(Path::new(FIXTURE).parent().unwrap()).unwrap();
            std::fs::write(FIXTURE, &text).unwrap();
        }
        let fixture =
            std::fs::read_to_string(FIXTURE).expect("fixture; run with UPDATE_FIXTURES=1");
        assert_eq!(
            text, fixture,
            "regenerate with UPDATE_FIXTURES=1 cargo test"
        );
    }

    #[test]
    fn recording_round_trips() {
        let dir = std::env::temp_dir().join(format!("frame-models-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_json(&dir.join(RECORDING_FILE), &recording()).unwrap();
        let back = read_recording(&dir).unwrap();
        assert_eq!(
            back.hands["right"].samples,
            recording().hands["right"].samples
        );
        let summary = summary(&models_from_recording(&back).unwrap());
        assert!(summary.contains("trigger"), "{summary}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
