from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"


def test_real_browser_can_mount_and_operate_the_multitrack_editor():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <button id="cfDriveSave"></button>
          <button id="browserExportClips"></button>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({
                projectName: "Prueba E2E",
                clips: [
                  {id:"c1", title:"Clip uno", start:0, end:2},
                  {id:"c2", title:"Clip dos", start:2, end:4},
                  {id:"c3", title:"Clip tres", start:4, end:6},
                  {id:"c4", title:"Clip cuatro", start:6, end:8}
                ]
              }),
              setTracks: () => {},
              setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{title:'Prueba E2E'}, index:0}}
        ))""")
        page.wait_for_timeout(250)
        assert page.locator("#cfNle").count() == 1, f"El editor no se montó. Errores JS: {page_errors}"
        assert page.locator("#cfNle").is_visible(), f"El editor está oculto. Errores JS: {page_errors}"
        assert page.locator(".cf-nle-media").is_visible()
        assert page.locator(".cf-nle-center").is_visible()
        assert page.locator(".cf-nle-inspector").is_visible()
        assert page.locator(".cf-nle-track").count() >= 4
        assert page.locator(".cf-nle-block").count() == 4

        page.locator('[data-track="audio"]').click()
        assert page.locator(".cf-nle-track").count() == 5

        page.locator('[data-act="text"]').click()
        assert page.locator(".cf-nle-block[data-type='text']").count() == 1
        page.locator(".cf-nle-block[data-type='text']").click()
        page.locator("#cfNleInspector textarea[data-k='text']").fill("Subtítulo de prueba")
        page.locator("#cfNleInspector textarea[data-k='text']").press("Tab")
        assert page.locator(".cf-nle-caption").filter(has_text="Subtítulo de prueba").count() == 1

        page.locator('[data-act="undo"]').click()
        assert page.locator(".cf-nle").is_visible()
        browser.close()
