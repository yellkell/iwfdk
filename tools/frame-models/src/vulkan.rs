//! The minimal Vulkan device an OpenXR session needs. Nothing is rendered;
//! the session only has to reach FOCUSED so input and render model states
//! flow. Adapted from FramePlayer's frame-probe.

use ash::vk::{self, Handle};
use openxr as xr;
use std::ffi::CString;

pub struct VulkanDevice {
    _entry: ash::Entry,
    instance: ash::Instance,
    device: ash::Device,
    pub create_info: xr::vulkan::SessionCreateInfo,
}

impl VulkanDevice {
    pub fn new(instance: &xr::Instance, system: xr::SystemId) -> Result<VulkanDevice, String> {
        let req = instance
            .graphics_requirements::<xr::Vulkan>(system)
            .map_err(xe("xrGetVulkanGraphicsRequirements2KHR"))?;
        let entry =
            unsafe { ash::Entry::load() }.map_err(|e| format!("loading libvulkan.so.1: {e}"))?;
        let max = req.max_api_version_supported;
        let api = if max.major() > 1 || max.minor() >= 3 {
            vk::API_VERSION_1_3
        } else {
            vk::API_VERSION_1_1
        };
        let app_name = CString::new("iwfdk-frame-models").unwrap();
        let app = vk::ApplicationInfo::default()
            .application_name(&app_name)
            .api_version(api);
        let ici = vk::InstanceCreateInfo::default().application_info(&app);
        let gipa: xr::sys::platform::VkGetInstanceProcAddr =
            unsafe { std::mem::transmute(entry.static_fn().get_instance_proc_addr) };
        let raw_instance =
            unsafe { instance.create_vulkan_instance(system, gipa, &ici as *const _ as *const _) }
                .map_err(xe("xrCreateVulkanInstanceKHR"))?
                .map_err(|r| format!("vkCreateInstance via OpenXR: VkResult {r}"))?;
        let vk_instance = unsafe {
            ash::Instance::load(entry.static_fn(), vk::Instance::from_raw(raw_instance as _))
        };

        let device = (|| {
            let raw_pd = unsafe { instance.vulkan_graphics_device(system, raw_instance) }
                .map_err(xe("xrGetVulkanGraphicsDevice2KHR"))?;
            let pd = vk::PhysicalDevice::from_raw(raw_pd as _);
            let families = unsafe { vk_instance.get_physical_device_queue_family_properties(pd) };
            let qfi = families
                .iter()
                .position(|f| f.queue_flags.contains(vk::QueueFlags::GRAPHICS))
                .ok_or("no graphics queue family")? as u32;
            let prio = [1.0f32];
            let qci = [vk::DeviceQueueCreateInfo::default()
                .queue_family_index(qfi)
                .queue_priorities(&prio)];
            let dci = vk::DeviceCreateInfo::default().queue_create_infos(&qci);
            let raw_device = unsafe {
                instance.create_vulkan_device(system, gipa, raw_pd, &dci as *const _ as *const _)
            }
            .map_err(xe("xrCreateVulkanDeviceKHR"))?
            .map_err(|r| format!("vkCreateDevice via OpenXR: VkResult {r}"))?;
            let device = unsafe {
                ash::Device::load(vk_instance.fp_v1_0(), vk::Device::from_raw(raw_device as _))
            };
            Ok::<_, String>((
                device,
                xr::vulkan::SessionCreateInfo {
                    instance: raw_instance,
                    physical_device: raw_pd,
                    device: raw_device,
                    queue_family_index: qfi,
                    queue_index: 0,
                },
            ))
        })();
        match device {
            Ok((device, create_info)) => Ok(VulkanDevice {
                _entry: entry,
                instance: vk_instance,
                device,
                create_info,
            }),
            Err(e) => {
                unsafe { vk_instance.destroy_instance(None) };
                Err(e)
            }
        }
    }
}

impl Drop for VulkanDevice {
    fn drop(&mut self) {
        unsafe {
            self.device.destroy_device(None);
            self.instance.destroy_instance(None);
        }
    }
}

fn xe(what: &'static str) -> impl Fn(xr::sys::Result) -> String {
    move |r| format!("{what}: XR_{r:?}")
}
