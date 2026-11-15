# SI-assisted: written with Claude (Anthropic) for the Ember Atlas 30-second demo video. Reviewed and run by Team Ainexa.
# Records scenes of the local site with CDP screencast -> JPEG frames + timestamps.
import asyncio, base64, json, os, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1]
BASE = "http://localhost:4179"

class Rec:
    def __init__(self, cdp, name):
        self.cdp, self.dir, self.ts, self.on = cdp, os.path.join(OUT, name), [], False
        os.makedirs(self.dir, exist_ok=True)
        for f in os.listdir(self.dir): os.remove(os.path.join(self.dir, f))
    async def frame(self, ev):
        if self.on:
            i = len(self.ts)
            open(os.path.join(self.dir, f"{i:05d}.jpg"), "wb").write(base64.b64decode(ev["data"]))
            self.ts.append(ev["metadata"]["timestamp"])
        try: await self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
        except Exception: pass
    async def start(self):
        self.on = True
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": 1920, "maxHeight": 1080, "everyNthFrame": 1})
    async def stop(self):
        self.on = False
        await self.cdp.send("Page.stopScreencast")
        json.dump(self.ts, open(os.path.join(self.dir, "ts.json"), "w"))
        print(os.path.basename(self.dir), len(self.ts), "frames", round(self.ts[-1] - self.ts[0], 2) if self.ts else 0, "s")

async def years(pg, ms):
    for i in range(25):
        await pg.evaluate("(i)=>{const r=document.querySelector('#tl-range'); r.value=i; r.dispatchEvent(new Event('input'))}", i)
        await pg.wait_for_timeout(ms)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=False, args=["--window-size=1920,1160", "--hide-scrollbars"])
        pg = await b.new_page(viewport={"width": 1920, "height": 1080})
        cdp = await pg.context.new_cdp_session(pg)
        rec = None
        cdp.on("Page.screencastFrame", lambda ev: asyncio.ensure_future(rec.frame(ev)) if rec else None)
        await pg.mouse.move(5, 1075)

        # scene 1: raw, years 2001 -> 2025
        await pg.goto(BASE + "/?mode=history")
        await pg.wait_for_selector("#loader.done", state="attached", timeout=180000)
        await pg.click("[data-src=raw]"); await pg.mouse.move(5, 1075)
        await pg.evaluate("()=>{const r=document.querySelector('#tl-range'); r.value=0; r.dispatchEvent(new Event('input'))}")
        await pg.wait_for_timeout(2500)
        rec = Rec(cdp, "s1"); await rec.start()
        await pg.wait_for_timeout(500); await years(pg, 240); await pg.wait_for_timeout(700)
        await rec.stop()

        # scene 3: unified, years 2001 -> 2025
        await pg.evaluate("()=>{const r=document.querySelector('#tl-range'); r.value=0; r.dispatchEvent(new Event('input'))}")
        await pg.wait_for_timeout(800)
        rec = Rec(cdp, "s3"); await rec.start()
        await pg.wait_for_timeout(400)
        await pg.click("[data-src=harm]"); await pg.mouse.move(5, 1075)
        await pg.wait_for_timeout(500); await years(pg, 250); await pg.wait_for_timeout(700)
        await rec.stop()

        # scene 4: fire calendar, Uzbekistan
        await pg.goto(BASE + "/?mode=calendar&area=country:Uzbekistan")
        await pg.wait_for_selector("#loader.done", state="attached", timeout=180000)
        await pg.wait_for_timeout(6000); await pg.mouse.move(5, 1075)
        rec = Rec(cdp, "s4"); await rec.start()
        await pg.wait_for_timeout(3000)
        await pg.click("[data-cc=anomaly]"); await pg.mouse.move(5, 1075)
        await pg.wait_for_timeout(3400)
        await rec.stop()
        await b.close()
asyncio.run(main())
