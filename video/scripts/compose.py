# SI-assisted: written with Claude (Anthropic) for the Ember Atlas 30-second demo video. Reviewed and run by Team Ainexa.
import json, os, subprocess, sys
S, OUT = sys.argv[1], sys.argv[2]
FF = open(os.path.join(S, "ffpath.txt")).read().strip()
run = lambda args: subprocess.run([FF, "-y", "-loglevel", "error"] + args, check=True)

def frames_clip(name, start, dur, cap, out):
    d = os.path.join(S, name); ts = json.load(open(os.path.join(d, "ts.json")))
    with open(os.path.join(d, "list.txt"), "w") as f:
        for i in range(len(ts)):
            f.write(f"file '{i:05d}.jpg'\nduration {(ts[i+1]-ts[i]) if i+1 < len(ts) else 0.05:.4f}\n")
        f.write(f"file '{len(ts)-1:05d}.jpg'\n")
    vf = (f"[0:v]fps=30,trim=start={start}:duration={dur},setpts=PTS-STARTPTS,scale=1920:1080:in_range=pc:out_range=tv,format=yuv420p[v];"
          f"[1:v]format=rgba,fade=in:st=0.35:d=0.45:alpha=1,fade=out:st={dur-0.55:.2f}:d=0.4:alpha=1[c];"
          f"[v][c]overlay=0:0:shortest=1,format=yuv420p[o]")
    run(["-f", "concat", "-safe", "0", "-i", os.path.join(d, "list.txt"), "-loop", "1", "-t", str(dur), "-i", os.path.join(S, cap + ".png"),
         "-filter_complex", vf, "-map", "[o]", "-r", "30", "-c:v", "libx264", "-crf", "16", "-preset", "medium", out])

def png_clip(name, dur, out, fadeout=False):
    vf = "format=yuv420p" + (f",fade=out:st={dur-0.5}:d=0.5" if fadeout else "")
    run(["-framerate", "30", "-i", os.path.join(S, name, "%05d.png"), "-t", str(dur), "-vf", vf, "-r", "30", "-c:v", "libx264", "-crf", "16", "-preset", "medium", out])

C = os.path.join(S, "clips"); os.makedirs(C, exist_ok=True)
frames_clip("s1", 0.4, 6.2, "cap1", f"{C}/1.mp4")
png_clip("s2", 6.6, f"{C}/2.mp4")
frames_clip("s3", 0.2, 7.4, "cap3", f"{C}/3.mp4")
frames_clip("s4", 0.3, 5.8, "cap4", f"{C}/4.mp4")
png_clip("s5", 4.0, f"{C}/5.mp4", fadeout=True)

A = os.path.join(S, "audio"); delays = [0.4, 6.4, 13.0, 20.4, 26.3]
inputs = []
for i in range(1, 6): inputs += ["-i", f"{C}/{i}.mp4"]
for i in range(1, 6): inputs += ["-i", f"{A}/l{i}.wav"]
inputs += ["-loop", "1", "-t", "30", "-i", os.path.join(S, "watermark.png")]
fc = "".join(f"[{i}:v]" for i in range(5)) + "concat=n=5:v=1:a=0,fade=in:st=0:d=0.4[v];"
fc = fc.replace("fade=in:st=0:d=0.4[v];", "fade=in:st=0:d=0.4[vb];[10:v]format=rgba[wm];[vb][wm]overlay=0:0,format=yuv420p[v];")
fc += "".join(f"[{5+i}:a]adelay={int(delays[i]*1000)}|{int(delays[i]*1000)}[a{i}];" for i in range(5))
fc += "".join(f"[a{i}]" for i in range(5)) + "amix=inputs=5:normalize=0,apad,atrim=0:30,volume=1.6[a]"
run(inputs + ["-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", "30", "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
              "-metadata", "title=Ember Atlas: one fire record from MODIS + VIIRS (30-second demo)",
              "-metadata", "artist=Team Ainexa",
              "-metadata", "comment=SI-assisted: video assembled and narration script written with Claude (Anthropic); narration is a synthetic text-to-speech voice (Microsoft Zira). Screen footage is the real Ember Atlas website. Data: NASA FIRMS MODIS + VIIRS.",
              OUT])
print("wrote", OUT)
