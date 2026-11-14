from playwright.sync_api import sync_playwright


def test_two_transform_keyframes_interpolate_in_preview():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            const project = {tracks:[{id:"v1",type:"video",name:"V1",items:[
              {id:"c1",kind:"clip",title:"Clip",start:0,end:5,sourceStart:0}
            ]}]};
            window.clipforgeEditorBridge = {
              getProject: () => project,
              setTracks: (tracks) => { project.tracks = tracks; },
              setProjectName: () => {}
            };
          </script>
        """)
        static = __import__("pathlib").Path(__file__).resolve().parents[1] / "static"
        page.add_script_tag(path=str(static / "capcut-editor.js"))
        page.add_script_tag(path=str(static / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip'},index:0}}
        ))""")
        clip = page.locator(".cf-nle-block[data-type='video']")
        clip.wait_for()
        clip.click()

        def seek(seconds):
            page.locator("#cfNleSeek").evaluate("""(el, value) => {
              el.value = String(value);
              el.dispatchEvent(new Event('input', {bubbles:true}));
            }""", seconds)

        def set_control(key, value):
            page.locator(f"#cfNleInspector [data-extra='{key}']").fill(str(value))

        seek(1)
        set_control("scale", 2)
        set_control("rotation", 20)
        set_control("opacity", 0.4)
        page.get_by_role("button", name="＋ Añadir fotograma clave").click()

        seek(3)
        set_control("scale", 3)
        set_control("rotation", 60)
        set_control("opacity", 0.8)
        page.get_by_role("button", name="＋ Añadir fotograma clave").click()

        frames = page.evaluate("""() => window.clipforgeEditorBridge.getProject()
          .tracks[0].items[0].keyframes""")
        assert len(frames) == 2, frames
        assert [round(frame["time"], 2) for frame in frames] == [1, 3]
        assert frames[0]["rotation"] == 20
        assert frames[1]["rotation"] == 60

        seek(2)
        video = page.locator("#cfNleVideo")
        page.wait_for_function("""() => {
          const video = document.querySelector('#cfNleVideo');
          return video && video.style.transform.includes('scale(2.5)');
        }""")
        transform = video.evaluate("(el) => el.style.transform")
        opacity = float(video.evaluate("(el) => el.style.opacity"))
        assert "rotate(40deg)" in transform, transform
        assert abs(opacity - 0.6) < 0.02, opacity
        browser.close()
