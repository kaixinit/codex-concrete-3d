"""Encode a real browser recording for GitHub; output only to the chosen prefix.

Example:
  python scripts/encode-showreel.py showreel.ivf \
    --output-prefix docs/media/showreel --gif-speed 2 \
    --gif-width 800 --gif-fps 10 --gif-colors 96
Input demuxing is automatic: IVF (including VP8), WebM, and other FFmpeg formats.
No capture, generated scene, or project source modification is performed here.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

import imageio_ffmpeg


def run(executable, arguments):
    result = subprocess.run([executable, "-hide_banner", "-nostdin", "-y", *arguments],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr[-5000:])
    return result


def inspect(executable, filename):
    # imageio-ffmpeg ships ffmpeg, not ffprobe. Inspect the real media stream
    # using ffmpeg itself; the no-output invocation intentionally exits with 1.
    result = subprocess.run([executable, "-hide_banner", "-i", str(filename)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    duration = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", result.stderr)
    video = next((line.strip() for line in result.stderr.splitlines() if "Video:" in line), None)
    seconds = (int(duration[1])*3600 + int(duration[2])*60 + float(duration[3])) if duration else None
    container = next((line.strip() for line in result.stderr.splitlines() if line.startswith("Input #0,")), None)
    return {"durationSeconds": seconds, "videoStream": video, "inputContainer": container.replace(str(filename), filename.name) if container else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("--output-prefix", required=True, type=pathlib.Path)
    parser.add_argument("--gif-start", type=float, default=0)
    parser.add_argument("--gif-seconds", type=float, default=30,
                        help="Source clip length, unless --gif-full-seconds selects the entire showreel.")
    gif_timing = parser.add_mutually_exclusive_group()
    gif_timing.add_argument("--gif-full-seconds", type=float,
                        help="Retain the full showreel after --gif-start, sped up to this GIF duration; recommended 24–36.")
    gif_timing.add_argument("--gif-speed", type=float,
                            help="Retain the full showreel at this playback speed; 52 seconds at 2x becomes 26 seconds.")
    parser.add_argument("--gif-width", type=int, default=800)
    parser.add_argument("--gif-fps", type=float, default=10)
    parser.add_argument("--gif-colors", type=int, default=96)
    parser.add_argument("--gif-dither", choices=["bayer", "none"], default="bayer")
    parser.add_argument("--gif-max-bytes", type=int, default=9_500_000,
                        help="Defaults below GitHub's 10 MB attachment limit.")
    parser.add_argument("--seconds", type=float, help="Optionally trim the MP4; otherwise retain the full recording.")
    args = parser.parse_args()
    if not args.input.is_file():
        parser.error("The real recording input does not exist.")
    if args.gif_start < 0 or args.gif_seconds <= 0 or args.gif_max_bytes <= 0:
        parser.error("GIF start/length/size arguments must be positive (start may be zero).")
    if args.seconds is not None and args.seconds <= 0:
        parser.error("MP4 length must be positive.")
    if args.gif_full_seconds is not None and args.gif_full_seconds <= 0:
        parser.error("Full-showreel GIF target length must be positive.")
    if args.gif_speed is not None and args.gif_speed <= 0:
        parser.error("Full-showreel GIF speed must be positive.")
    if not 64 <= args.gif_width <= 1280 or args.gif_width % 2 or not 1 <= args.gif_fps <= 30 or not 4 <= args.gif_colors <= 256:
        parser.error("GIF width must be even (64–1280), fps 1–30, and palette colors 4–256.")
    executable = imageio_ffmpeg.get_ffmpeg_exe()
    prefix = args.output_prefix.resolve()
    prefix.parent.mkdir(parents=True, exist_ok=True)
    mp4 = prefix.with_suffix(".mp4")
    gif = prefix.parent / (prefix.name + "-preview.gif")
    manifest = prefix.parent / (prefix.name + "-encoding.json")
    source = args.input.resolve()
    if source in (mp4, gif):
        parser.error("Input and output paths must be different.")
    source_info = inspect(executable, source)
    if not source_info["videoStream"]:
        raise RuntimeError("FFmpeg could not detect a real video stream in the input (IVF and WebM are accepted).")

    # Even dimensions, 30 fps CFR, H.264 / 4:2:0 and faststart cover common
    # browser players. A 1.6 Mb/s VBV ceiling is about 9 MB for 45 seconds.
    scale = "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1"
    run(executable, ["-i", str(source), *(["-t", str(args.seconds)] if args.seconds else []),
                    "-map", "0:v:0", "-an", "-vf", scale, "-c:v", "libx264",
                    "-preset", "medium", "-crf", "23", "-maxrate", "1600k", "-bufsize", "3200k",
                    "-profile:v", "high", "-level:v", "3.1", "-pix_fmt", "yuv420p",
                    "-r", "30", "-fps_mode", "cfr", "-movflags", "+faststart", str(mp4)])
    mp4_info = inspect(executable, mp4)
    if not mp4_info["videoStream"] or "h264" not in mp4_info["videoStream"] or "yuv420p" not in mp4_info["videoStream"] or "1280x720" not in mp4_info["videoStream"]:
        raise RuntimeError("Encoded MP4 did not match H.264 / yuv420p / 1280x720.")
    run(executable, ["-v", "error", "-i", str(mp4), "-map", "0:v:0", "-f", "null", "-"])

    # Keep all business shots in full-showreel mode. Temporal compression
    # changes playback speed; it never substitutes shots or drops the ending.
    available_seconds = mp4_info["durationSeconds"]
    if available_seconds is None or args.gif_start >= available_seconds:
        raise RuntimeError("Cannot determine the GIF range from the encoded MP4, or start is beyond its end.")
    full_mode = args.gif_full_seconds is not None or args.gif_speed is not None
    source_seconds = (available_seconds - args.gif_start) if full_mode else min(args.gif_seconds, available_seconds - args.gif_start)
    gif_target_seconds = source_seconds / args.gif_speed if args.gif_speed is not None else min(args.gif_full_seconds, source_seconds) if args.gif_full_seconds is not None else source_seconds
    time_scale = gif_target_seconds / source_seconds
    # Preserve that entire selected time range while adapting only spatial
    # detail / frame rate / palette to the measured file size.
    attempts = []
    candidates = list(dict.fromkeys([
        (args.gif_width, args.gif_fps, args.gif_colors),
        (min(args.gif_width, 720), min(args.gif_fps, 8), min(args.gif_colors, 96)),
        (min(args.gif_width, 640), min(args.gif_fps, 8), min(args.gif_colors, 80)),
        (min(args.gif_width, 560), min(args.gif_fps, 6), min(args.gif_colors, 64)),
    ]))
    for width, fps, colors in candidates:
        graph = (f"[0:v]setpts=(PTS-STARTPTS)*{time_scale:.10f},fps={fps}:eof_action=pass,scale={width}:-2:flags=lanczos,split[a][b];"
                 f"[a]palettegen=max_colors={colors}:stats_mode=diff[p];"
                 f"[b][p]paletteuse=dither={args.gif_dither}:bayer_scale=3:diff_mode=rectangle[out]")
        run(executable, ["-ss", str(args.gif_start), "-t", str(source_seconds), "-i", str(mp4),
                        "-an", "-filter_complex", graph, "-map", "[out]", "-loop", "0", str(gif)])
        size = gif.stat().st_size
        attempts.append({"width": width, "fps": fps, "paletteColors": colors, "dither": args.gif_dither, "bytes": size})
        if size <= args.gif_max_bytes:
            break
    else:
        raise RuntimeError("GIF still exceeds the size budget; lower --gif-width/--gif-fps/--gif-colors. The full MP4 and selected source time range are retained.")

    from PIL import Image
    with Image.open(gif) as image:
        duration_ms = 0
        for frame in range(image.n_frames):
            image.seek(frame)
            duration_ms += image.info.get("duration", 0)
        gif_info = {"width": image.width, "height": image.height, "frames": image.n_frames,
                    "loop": image.info.get("loop"), "bytes": gif.stat().st_size,
                    "mode": "full-showreel" if full_mode else "selected-range",
                    "sourceStartSeconds": args.gif_start, "sourceLengthSeconds": source_seconds,
                    "targetLengthSeconds": gif_target_seconds, "actualLengthSeconds": duration_ms / 1000,
                    "playbackSpeed": 1 / time_scale,
                    "chosenSettings": attempts[-1], "attempts": attempts}
    if gif_info["frames"] < 2:
        raise RuntimeError("GIF is not animated; check the input recording and selected range.")
    mp4_bytes = mp4.stat().st_size
    result = {"source": source.name, "sourceInspection": source_info, "ffmpeg": pathlib.Path(executable).name,
              "mp4": {"file": mp4.name, "bytes": mp4_bytes, **mp4_info,
                      "below10MB": mp4_bytes < 10_000_000, "silent": True, "faststart": True},
              "gif": {"file": gif.name, **gif_info}}
    manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
