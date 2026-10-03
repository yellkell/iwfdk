//! Thin wrappers over XR_EXT_render_model and XR_EXT_interaction_render_model.

use crate::calibrate::{NodeSample, Pose};
use openxr as xr;
use openxr::sys;
use openxr::sys::Handle;
use std::ffi::CStr;
use std::ptr;

fn check(r: sys::Result, what: &str) -> Result<(), String> {
    if r.into_raw() >= 0 {
        Ok(())
    } else {
        Err(format!("{what}: XR_{r:?}"))
    }
}

pub fn pose_from_xr(p: &sys::Posef) -> Pose {
    Pose {
        position: [p.position.x, p.position.y, p.position.z],
        orientation: [
            p.orientation.x,
            p.orientation.y,
            p.orientation.z,
            p.orientation.w,
        ],
    }
}

pub struct RenderModelApi {
    rm: xr::raw::RenderModelEXT,
    irm: xr::raw::InteractionRenderModelEXT,
}

/// One runtime render model with its downloaded asset.
pub struct Model {
    pub handle: sys::RenderModelEXT,
    pub space: sys::Space,
    pub glb: Vec<u8>,
    pub node_names: Vec<String>,
}

impl RenderModelApi {
    pub fn new(instance: &xr::Instance) -> Result<RenderModelApi, String> {
        let exts = instance.exts();
        Ok(RenderModelApi {
            rm: exts
                .ext_render_model
                .ok_or("XR_EXT_render_model not enabled")?,
            irm: exts
                .ext_interaction_render_model
                .ok_or("XR_EXT_interaction_render_model not enabled")?,
        })
    }

    /// Render model ids for the interaction devices in use.
    pub fn interaction_ids(
        &self,
        session: sys::Session,
    ) -> Result<Vec<sys::RenderModelIdEXT>, String> {
        let info = sys::InteractionRenderModelIdsEnumerateInfoEXT {
            ty: sys::InteractionRenderModelIdsEnumerateInfoEXT::TYPE,
            next: ptr::null(),
        };
        let mut count = 0u32;
        unsafe {
            check(
                (self.irm.enumerate_interaction_render_model_ids)(
                    session,
                    &info,
                    0,
                    &mut count,
                    ptr::null_mut(),
                ),
                "xrEnumerateInteractionRenderModelIdsEXT",
            )?;
            let mut ids = vec![sys::RenderModelIdEXT::from_raw(0); count as usize];
            check(
                (self.irm.enumerate_interaction_render_model_ids)(
                    session,
                    &info,
                    count,
                    &mut count,
                    ids.as_mut_ptr(),
                ),
                "xrEnumerateInteractionRenderModelIdsEXT",
            )?;
            ids.truncate(count as usize);
            Ok(ids)
        }
    }

    pub fn create(
        &self,
        session: sys::Session,
        id: sys::RenderModelIdEXT,
    ) -> Result<sys::RenderModelEXT, String> {
        // Interaction render models must be available without any glTF
        // extensions, which keeps the asset loadable by any glTF loader.
        let info = sys::RenderModelCreateInfoEXT {
            ty: sys::RenderModelCreateInfoEXT::TYPE,
            next: ptr::null(),
            render_model_id: id,
            gltf_extension_count: 0,
            gltf_extensions: ptr::null(),
        };
        let mut handle = sys::RenderModelEXT::NULL;
        check(
            unsafe { (self.rm.create_render_model)(session, &info, &mut handle) },
            "xrCreateRenderModelEXT",
        )?;
        Ok(handle)
    }

    /// Subaction paths (`/user/hand/left` ...) the model is associated with.
    pub fn subaction_paths(&self, model: sys::RenderModelEXT) -> Result<Vec<sys::Path>, String> {
        let info = sys::InteractionRenderModelSubactionPathInfoEXT {
            ty: sys::InteractionRenderModelSubactionPathInfoEXT::TYPE,
            next: ptr::null(),
        };
        let mut count = 0u32;
        unsafe {
            check(
                (self.irm.enumerate_render_model_subaction_paths)(
                    model,
                    &info,
                    0,
                    &mut count,
                    ptr::null_mut(),
                ),
                "xrEnumerateRenderModelSubactionPathsEXT",
            )?;
            let mut paths = vec![sys::Path::NULL; count as usize];
            check(
                (self.irm.enumerate_render_model_subaction_paths)(
                    model,
                    &info,
                    count,
                    &mut count,
                    paths.as_mut_ptr(),
                ),
                "xrEnumerateRenderModelSubactionPathsEXT",
            )?;
            paths.truncate(count as usize);
            Ok(paths)
        }
    }

    /// Download the GLB and the animatable node names, and create the
    /// model's space.
    pub fn load(
        &self,
        session: sys::Session,
        handle: sys::RenderModelEXT,
    ) -> Result<Model, String> {
        let get = sys::RenderModelPropertiesGetInfoEXT {
            ty: sys::RenderModelPropertiesGetInfoEXT::TYPE,
            next: ptr::null(),
        };
        let mut props = sys::RenderModelPropertiesEXT {
            ty: sys::RenderModelPropertiesEXT::TYPE,
            next: ptr::null_mut(),
            cache_id: sys::UuidEXT { data: [0; 16] },
            animatable_node_count: 0,
        };
        check(
            unsafe { (self.rm.get_render_model_properties)(handle, &get, &mut props) },
            "xrGetRenderModelPropertiesEXT",
        )?;

        let asset_info = sys::RenderModelAssetCreateInfoEXT {
            ty: sys::RenderModelAssetCreateInfoEXT::TYPE,
            next: ptr::null(),
            cache_id: props.cache_id,
        };
        let mut asset = sys::RenderModelAssetEXT::NULL;
        check(
            unsafe { (self.rm.create_render_model_asset)(session, &asset_info, &mut asset) },
            "xrCreateRenderModelAssetEXT",
        )?;
        let result = (|| {
            let data_get = sys::RenderModelAssetDataGetInfoEXT {
                ty: sys::RenderModelAssetDataGetInfoEXT::TYPE,
                next: ptr::null(),
            };
            let mut data = sys::RenderModelAssetDataEXT {
                ty: sys::RenderModelAssetDataEXT::TYPE,
                next: ptr::null_mut(),
                buffer_capacity_input: 0,
                buffer_count_output: 0,
                buffer: ptr::null_mut(),
            };
            check(
                unsafe { (self.rm.get_render_model_asset_data)(asset, &data_get, &mut data) },
                "xrGetRenderModelAssetDataEXT (size)",
            )?;
            let mut glb = vec![0u8; data.buffer_count_output as usize];
            data.buffer_capacity_input = glb.len() as u32;
            data.buffer = glb.as_mut_ptr();
            check(
                unsafe { (self.rm.get_render_model_asset_data)(asset, &data_get, &mut data) },
                "xrGetRenderModelAssetDataEXT",
            )?;
            glb.truncate(data.buffer_count_output as usize);

            let names_get = sys::RenderModelAssetPropertiesGetInfoEXT {
                ty: sys::RenderModelAssetPropertiesGetInfoEXT::TYPE,
                next: ptr::null(),
            };
            let n = props.animatable_node_count as usize;
            let mut nodes = vec![
                sys::RenderModelAssetNodePropertiesEXT {
                    unique_name: [0; sys::MAX_RENDER_MODEL_ASSET_NODE_NAME_SIZE_EXT],
                };
                n
            ];
            let mut names_out = sys::RenderModelAssetPropertiesEXT {
                ty: sys::RenderModelAssetPropertiesEXT::TYPE,
                next: ptr::null_mut(),
                node_property_count: n as u32,
                node_properties: nodes.as_mut_ptr(),
            };
            check(
                unsafe {
                    (self.rm.get_render_model_asset_properties)(asset, &names_get, &mut names_out)
                },
                "xrGetRenderModelAssetPropertiesEXT",
            )?;
            let node_names = nodes
                .iter()
                .map(|p| {
                    unsafe { CStr::from_ptr(p.unique_name.as_ptr()) }
                        .to_string_lossy()
                        .into_owned()
                })
                .collect();
            Ok::<_, String>((glb, node_names))
        })();
        unsafe { (self.rm.destroy_render_model_asset)(asset) };
        let (glb, node_names) = result?;

        let space_info = sys::RenderModelSpaceCreateInfoEXT {
            ty: sys::RenderModelSpaceCreateInfoEXT::TYPE,
            next: ptr::null(),
            render_model: handle,
        };
        let mut space = sys::Space::NULL;
        check(
            unsafe { (self.rm.create_render_model_space)(session, &space_info, &mut space) },
            "xrCreateRenderModelSpaceEXT",
        )?;
        Ok(Model {
            handle,
            space,
            glb,
            node_names,
        })
    }

    /// Node states at `time`, in node-name order.
    pub fn state(&self, model: &Model, time: xr::Time) -> Result<Vec<NodeSample>, String> {
        let info = sys::RenderModelStateGetInfoEXT {
            ty: sys::RenderModelStateGetInfoEXT::TYPE,
            next: ptr::null(),
            display_time: time,
        };
        let mut states = vec![
            sys::RenderModelNodeStateEXT {
                node_pose: sys::Posef::IDENTITY,
                is_visible: sys::FALSE,
            };
            model.node_names.len()
        ];
        let mut out = sys::RenderModelStateEXT {
            ty: sys::RenderModelStateEXT::TYPE,
            next: ptr::null_mut(),
            node_state_count: states.len() as u32,
            node_states: states.as_mut_ptr(),
        };
        check(
            unsafe { (self.rm.get_render_model_state)(model.handle, &info, &mut out) },
            "xrGetRenderModelStateEXT",
        )?;
        Ok(states
            .iter()
            .map(|s| NodeSample {
                pose: pose_from_xr(&s.node_pose),
                visible: s.is_visible == sys::TRUE,
            })
            .collect())
    }

    /// Destroy a render model. Spaces created from it should be destroyed
    /// first (callers wrap `Model::space` in an `xr::Space`).
    pub fn destroy(&self, handle: sys::RenderModelEXT) {
        unsafe { (self.rm.destroy_render_model)(handle) };
    }
}
