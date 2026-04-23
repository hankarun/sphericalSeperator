// reproject.rs — Equirectangular → Pinhole camera reprojection
//
// Given an equirectangular source image and a virtual pinhole camera
// (defined by yaw/azimuth, pitch/elevation, roll, field-of-view, and
// output resolution), this module produces a rectilinear perspective image.

use glam::{Mat3, Vec3};
use image::{ImageBuffer, Rgb};

/// Virtual camera definition (all angles in degrees).
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct VirtualCamera {
    pub id: String,
    pub name: String,
    /// Horizontal rotation around Y-axis (0 = forward, positive = right)
    pub yaw_deg: f32,
    /// Vertical rotation (0 = horizon, positive = up)
    pub pitch_deg: f32,
    /// Roll around the viewing axis
    pub roll_deg: f32,
    /// Horizontal field of view in degrees (e.g. 90)
    pub fov_h_deg: f32,
    /// Output image width in pixels
    pub out_width: u32,
    /// Output image height in pixels
    pub out_height: u32,
}

/// Reproject equirectangular source into a pinhole perspective view.
pub fn reproject(
    src: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    cam: &VirtualCamera,
) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
    let src_w = src.width() as f32;
    let src_h = src.height() as f32;
    let out_w = cam.out_width;
    let out_h = cam.out_height;

    // Build rotation matrix: yaw × pitch × roll (applied right-to-left)
    let yaw = cam.yaw_deg.to_radians();
    let pitch = cam.pitch_deg.to_radians();
    let roll = cam.roll_deg.to_radians();

    // Rotation matrices (right-hand coordinate system, Y-up)
    let rot_y = Mat3::from_rotation_y(yaw);
    let rot_x = Mat3::from_rotation_x(-pitch); // negative: positive pitch = look up
    let rot_z = Mat3::from_rotation_z(roll);
    let rot = rot_y * rot_x * rot_z;

    // Focal length from horizontal FOV
    let fov_h_rad = cam.fov_h_deg.to_radians();
    let fx = (out_w as f32 / 2.0) / (fov_h_rad / 2.0).tan();
    let fy = fx; // square pixels
    let cx = out_w as f32 / 2.0;
    let cy = out_h as f32 / 2.0;

    let mut out: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(out_w, out_h);

    for py in 0..out_h {
        for px in 0..out_w {
            // Direction in camera space
            let dx = (px as f32 - cx) / fx;
            let dy = (py as f32 - cy) / fy;
            let dz = 1.0_f32;
            let dir_cam = Vec3::new(dx, -dy, dz).normalize(); // flip Y for image coords

            // Rotate into world space
            let dir_world = rot * dir_cam;

            // Convert 3D direction → equirectangular (lon, lat)
            let lon = dir_world.z.atan2(-dir_world.x); // negate X to match viewport yaw convention
            let lat = dir_world.y.asin().clamp(-std::f32::consts::FRAC_PI_2, std::f32::consts::FRAC_PI_2);

            // Map to equirectangular UV [0, src_w) × [0, src_h)
            let u = (lon / std::f32::consts::TAU + 0.5) * src_w;
            let v = (0.5 - lat / std::f32::consts::PI) * src_h;

            // Bilinear interpolation
            let pixel = bilinear_sample(src, u, v);
            out.put_pixel(px, py, pixel);
        }
    }

    out
}

/// Bilinear sample of an equirectangular image with wraparound on U axis.
fn bilinear_sample(img: &ImageBuffer<Rgb<u8>, Vec<u8>>, u: f32, v: f32) -> Rgb<u8> {
    let w = img.width() as f32;
    let h = img.height() as f32;

    let x0 = u.floor() as i64;
    let y0 = v.floor().clamp(0.0, h - 1.0) as i64;
    let x1 = x0 + 1;
    let y1 = (y0 + 1).min(img.height() as i64 - 1);

    let fx = u - u.floor();
    let fy = v - v.floor();

    let wrap_x = |x: i64| -> u32 {
        let w_i = img.width() as i64;
        ((x % w_i + w_i) % w_i) as u32
    };

    let p00 = img.get_pixel(wrap_x(x0), y0 as u32);
    let p10 = img.get_pixel(wrap_x(x1), y0 as u32);
    let p01 = img.get_pixel(wrap_x(x0), y1 as u32);
    let p11 = img.get_pixel(wrap_x(x1), y1 as u32);

    let lerp = |a: u8, b: u8, t: f32| -> u8 {
        (a as f32 * (1.0 - t) + b as f32 * t).round().clamp(0.0, 255.0) as u8
    };

    let r = lerp(
        lerp(p00[0], p10[0], fx),
        lerp(p01[0], p11[0], fx),
        fy,
    );
    let g = lerp(
        lerp(p00[1], p10[1], fx),
        lerp(p01[1], p11[1], fx),
        fy,
    );
    let b = lerp(
        lerp(p00[2], p10[2], fx),
        lerp(p01[2], p11[2], fx),
        fy,
    );

    Rgb([r, g, b])
}
