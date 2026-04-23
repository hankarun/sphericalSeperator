// video.rs — ffmpeg-based video frame decoder
use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use image::{ImageBuffer, Rgb};

/// Metadata returned to the frontend when a video is opened.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct VideoMeta {
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

/// Decode a single video frame at the given timestamp (milliseconds).
/// Returns an RGB image buffer.
pub fn decode_frame_at(path: &str, timestamp_ms: u64) -> Result<ImageBuffer<Rgb<u8>, Vec<u8>>> {
    ffmpeg::init().context("Failed to initialise ffmpeg")?;

    let mut ictx = ffmpeg::format::input(&path).context("Cannot open video file")?;

    let video_stream_index = ictx
        .streams()
        .best(ffmpeg::media::Type::Video)
        .context("No video stream found")?
        .index();

    let stream = ictx.stream(video_stream_index).unwrap();
    let _time_base = stream.time_base(); // kept for reference, seek uses AV_TIME_BASE

    // Convert ms → AV_TIME_BASE units (microseconds, stream_index = -1)
    let target_pts = (timestamp_ms as i64) * 1000;

    // Seek using AV_TIME_BASE (avformat_seek_file with stream_index=-1)
    ictx.seek(target_pts, ..target_pts)
        .context("Seek failed")?;

    let codec_params = ictx.stream(video_stream_index).unwrap().parameters();
    let decoder_ctx = ffmpeg::codec::context::Context::from_parameters(codec_params)
        .context("Failed to create codec context")?;
    let mut decoder = decoder_ctx
        .decoder()
        .video()
        .context("Failed to open video decoder")?;

    let width = decoder.width();
    let height = decoder.height();

    // Scaler: convert whatever pixel format → RGB24
    let mut scaler = ffmpeg::software::scaling::context::Context::get(
        decoder.format(),
        width,
        height,
        ffmpeg::format::Pixel::RGB24,
        width,
        height,
        ffmpeg::software::scaling::flag::Flags::BILINEAR,
    )
    .context("Failed to create scaler")?;

    let mut rgb_frame = ffmpeg::frame::Video::empty();

    for (stream, packet) in ictx.packets() {
        if stream.index() != video_stream_index {
            continue;
        }
        decoder.send_packet(&packet).ok();

        let mut decoded = ffmpeg::frame::Video::empty();
        while decoder.receive_frame(&mut decoded).is_ok() {
            scaler
                .run(&decoded, &mut rgb_frame)
                .context("Scaler failed")?;

            // Convert to image crate buffer
            let data = rgb_frame.data(0);
            let stride = rgb_frame.stride(0);
            let mut pixels = Vec::with_capacity((width * height * 3) as usize);
            for row in 0..height as usize {
                let start = row * stride;
                pixels.extend_from_slice(&data[start..start + width as usize * 3]);
            }
            let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
                ImageBuffer::from_raw(width, height, pixels)
                    .context("Failed to build ImageBuffer")?;
            return Ok(img);
        }
    }

    anyhow::bail!("Could not decode a frame at {}ms", timestamp_ms);
}

/// Return video metadata without decoding any frames.
pub fn video_meta(path: &str) -> Result<VideoMeta> {
    ffmpeg::init().context("Failed to initialise ffmpeg")?;
    let ictx = ffmpeg::format::input(&path).context("Cannot open video file")?;

    let stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Video)
        .context("No video stream found")?;

    let codec_params = stream.parameters();
    let decoder_ctx = ffmpeg::codec::context::Context::from_parameters(codec_params)
        .context("Failed to create codec context")?;
    let decoder = decoder_ctx
        .decoder()
        .video()
        .context("Failed to open video decoder")?;

    let duration_ms = if ictx.duration() > 0 {
        (ictx.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64 * 1000.0) as u64
    } else {
        0
    };

    let time_base = stream.time_base();
    let fps = if time_base.0 > 0 {
        stream.avg_frame_rate().0 as f64 / stream.avg_frame_rate().1 as f64
    } else {
        30.0
    };

    Ok(VideoMeta {
        duration_ms,
        width: decoder.width(),
        height: decoder.height(),
        fps,
    })
}
