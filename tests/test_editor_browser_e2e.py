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

def test_copy_paste_preserves_clip_track_type_and_is_undoable():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{
                id:"v1",type:"video",name:"V1 · Vídeo",items:[
                  {id:"c1",kind:"clip",title:"Clip uno",start:0,end:2},
                  {id:"c2",kind:"clip",title:"Clip dos",start:2,end:4},
                  {id:"c3",kind:"clip",title:"Clip tres",start:4,end:6},
                  {id:"c4",kind:"clip",title:"Clip cuatro",start:6,end:8}
                ]
              }]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip uno'},index:0}}
        ))""")
        # open-editor is async (IndexedDB media restoration); wait for the rendered
        # timeline, not merely for the editor shell mounted before its first render.
        try:
            page.wait_for_function(
                "() => document.querySelectorAll(\".cf-nle-block[data-type='video']\").length === 4",
                timeout=10000,
            )
        except Exception as exc:
            diagnostics = page.evaluate("""() => ({
              editor: Boolean(document.querySelector('#cfNle')),
              status: document.querySelector('#cfNleStatus')?.textContent || null,
              tracks: document.querySelectorAll('.cf-nle-track').length,
              blocks: document.querySelectorAll('.cf-nle-block').length,
              timeline: document.querySelector('#cfNleTimeline')?.innerHTML || null
            })""")
            raise AssertionError(
                f"No se renderizaron los cuatro clips. Estado: {diagnostics}; "
                f"errores JS: {page_errors}"
            ) from exc
        assert page.locator(".cf-nle-block[data-type='video']").count() == 4
        page.locator(".cf-nle-block[data-type='video']").first.click()
        page.locator('[data-act="copy"]').click()
        page.locator("#cfNleSeek").evaluate("""el => {
          el.value = '10';
          el.dispatchEvent(new Event('input', {bubbles:true}));
        }""")
        page.locator('[data-act="paste"]').click()
        assert page.locator(".cf-nle-block[data-type='video']").count() == 5
        page.locator('[data-act="undo"]').click()
        assert page.locator(".cf-nle-block[data-type='video']").count() == 4
        browser.close()


def test_paste_into_locked_track_creates_compatible_track_and_undo_removes_it():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{
                id:"v1",type:"video",name:"V1 · Vídeo",locked:true,items:[
                  {id:"c1",kind:"clip",title:"Clip uno",start:0,end:2}
                ]
              }]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip uno'},index:0}}
        ))""")
        page.wait_for_function(
            "() => document.querySelectorAll(\".cf-nle-block[data-type='video']\").length === 1",
            timeout=10000,
        )
        page.locator(".cf-nle-block[data-type='video']").first.click()
        page.locator('[data-act="copy"]').click()
        page.locator("#cfNleSeek").evaluate("""el => {
          el.value = '5';
          el.dispatchEvent(new Event('input', {bubbles:true}));
        }""")
        page.locator('[data-act="paste"]').click()
        assert page.locator(".cf-nle-track").count() == 2, (
            f"No se creó una pista compatible. Errores JS: {page_errors}"
        )
        assert page.locator(".cf-nle-block[data-type='video']").count() == 2
        page.locator('[data-act="undo"]').click()
        assert page.locator(".cf-nle-track").count() == 1
        assert page.locator(".cf-nle-block[data-type='video']").count() == 1
        browser.close()


def test_timeline_playhead_continues_when_video_crosses_clip_boundary():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{
                id:"v1",type:"video",name:"V1 · Vídeo",items:[
                  {id:"c1",kind:"clip",title:"Clip uno",start:0,end:2,sourceStart:0},
                  {id:"c2",kind:"clip",title:"Clip dos",start:2,end:4,sourceStart:2}
                ]
              }]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip uno'},index:0}}
        ))""")
        page.wait_for_function(
            "() => document.querySelectorAll(\".cf-nle-block[data-type='video']\").length === 2",
            timeout=10000,
        )
        page.evaluate("""() => {
          const video = document.querySelector('#cfNleVideo');
          Object.defineProperty(video, 'currentTime', {
            configurable: true, value: 2.1
          });
          video.ontimeupdate();
          video.ontimeupdate();
        }""")
        assert page.locator("#cfNleTime").inner_text() == "00:02.10", (
            f"El cabezal se congeló al pasar al segundo clip. Errores JS: {page_errors}"
        )
        browser.close()


def test_editor_keyboard_shortcuts_copy_paste_undo_duplicate_and_delete():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{
                id:"v1",type:"video",name:"V1 · Vídeo",items:[
                  {id:"c1",kind:"clip",title:"Clip uno",start:0,end:2}
                ]
              }]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip uno'},index:0}}
        ))""")
        page.wait_for_function(
            "() => document.querySelectorAll(\".cf-nle-block[data-type='video']\").length === 1",
            timeout=10000,
        )
        blocks = page.locator(".cf-nle-block[data-type='video']")
        blocks.first.click()
        page.keyboard.press("Control+c")
        page.locator("#cfNleSeek").evaluate("""el => {
          el.value = '5';
          el.dispatchEvent(new Event('input', {bubbles:true}));
        }""")
        page.keyboard.press("Control+v")
        assert blocks.count() == 2
        page.keyboard.press("Control+z")
        assert blocks.count() == 1
        page.keyboard.press("Control+Shift+z")
        assert blocks.count() == 2
        page.keyboard.press("d")
        assert blocks.count() == 3
        page.keyboard.press("Delete")
        assert blocks.count() == 2
        blocks.first.dispatch_event("click")
        assert blocks.first.get_attribute("class").find("selected") >= 0
        page.keyboard.press("Control+x")
        assert blocks.count() == 1
        browser.close()


def test_right_click_clip_opens_context_menu_with_working_actions():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{id:"v1",type:"video",name:"V1",items:[
                {id:"c1",kind:"clip",title:"Clip uno",start:0,end:2}
              ]}]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip uno'},index:0}}
        ))""")
        clip = page.locator(".cf-nle-block[data-type='video']").first
        clip.wait_for()
        clip.click(button="right")
        menu = page.locator("#cfNleClipMenu")
        assert menu.is_visible()
        assert menu.get_by_role("menuitem", name="Dividir en el cabezal").count() == 1
        assert menu.get_by_role("menuitem", name="Recortar inicio hasta aquí").count() == 1
        menu.get_by_role("menuitem", name="Duplicar fragmento").click()
        assert page.locator(".cf-nle-block[data-type='video']").count() == 2
        assert menu.is_hidden()
        browser.close()



def test_context_menu_disables_trimming_on_locked_tracks():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{id:"v1",type:"video",name:"V1",locked:true,items:[
                {id:"c1",kind:"clip",title:"Clip bloqueado",start:0,end:2}
              ]}]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip bloqueado'},index:0}}
        ))""")
        clip = page.locator(".cf-nle-block[data-type='video']").first
        clip.wait_for()
        clip.click(button="right")
        menu = page.locator("#cfNleClipMenu")
        assert menu.is_visible()
        assert menu.get_by_role("menuitem", name="Recortar inicio hasta aquí").is_disabled()
        assert menu.get_by_role("menuitem", name="Recortar final hasta aquí").is_disabled()
        assert menu.get_by_role("menuitem", name="Ir al inicio del fragmento").is_enabled()
        browser.close()


def test_audio_track_renders_waveform_from_decoded_media_samples():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[
                {id:"v1",type:"video",name:"V1",items:[]},
                {id:"a1",type:"audio",name:"A1",items:[
                  {id:"a1i",kind:"audio",assetId:"audio-fixture",title:"Música",url:"blob:fixture",start:0,end:3}
                ]}
              ]}),
              setTracks: () => {}, setProjectName: () => {}
            };
            window.clipforgeMediaStore = {load: async () => new Blob(["fixture"],{type:"audio/wav"})};
            window.AudioContext = class {
              async decodeAudioData() {
                return {
                  numberOfChannels:1,length:1000,
                  getChannelData:() => Float32Array.from({length:1000},(_,i)=>Math.sin(i/9)*.7)
                };
              }
              async close() {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => { window.clipforgeMediaStore = {load: async () => new Blob(["fixture"], {type:"audio/wav"})}; }""")
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{title:'Audio waveform'},index:0}}
        ))""")
        page.wait_for_function(
            "() => document.querySelector('.cf-nle-waveform') !== null",
            timeout=10000,
        )
        canvas = page.locator(".cf-nle-waveform")
        assert canvas.count() == 1
        assert canvas.evaluate("(el) => el.width > 24 && el.height === 48")
        browser.close()


def test_modifier_multi_select_duplicates_and_deletes_as_a_group():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{id:"v1",type:"video",name:"V1",items:[
                {id:"c1",kind:"clip",title:"Uno",start:0,end:2},
                {id:"c2",kind:"clip",title:"Dos",start:3,end:5},
                {id:"c3",kind:"clip",title:"Tres",start:6,end:8}
              ]}]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Uno'},index:0}}
        ))""")
        page.wait_for_function(
            "() => document.querySelectorAll('.cf-nle-block[data-type=video]').length === 3",
            timeout=10000,
        )
        blocks = page.locator(".cf-nle-block[data-type='video']")
        blocks.nth(0).click()
        blocks.nth(1).click(modifiers=["Control"])
        assert page.locator(".cf-nle-block.selected").count() == 2
        page.locator('[data-act="duplicate"]').click()
        assert blocks.count() == 5
        assert page.locator(".cf-nle-block.selected").count() == 2
        page.locator('[data-act="delete"]').click()
        assert blocks.count() == 3
        browser.close()

def test_timeline_drag_snaps_clip_edge_to_previous_clip_boundary():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{id:"v1",type:"video",name:"V1",items:[
                {id:"c1",kind:"clip",title:"Primero",start:0,end:2},
                {id:"c2",kind:"clip",title:"Segundo",start:3,end:5}
              ]}]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Primero'},index:0}}
        ))""")
        blocks = page.locator(".cf-nle-block[data-type='video']")
        page.wait_for_function("() => document.querySelectorAll('.cf-nle-block[data-type=video]').length === 2")
        box = blocks.nth(1).bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - 16, y, steps=4)
        page.mouse.up()
        page.wait_for_function("""() => {
          const item = window.clipforgeEditorBridge.getProject().tracks[0].items.find(x => x.id === 'c2');
          return item && Math.abs(item.start - 2) < .001;
        }""")
        item = page.evaluate("() => window.clipforgeEditorBridge.getProject().tracks[0].items.find(x => x.id === 'c2')")
        assert abs(item["start"] - 2) < .001
        assert item["end"] == 4
        browser.close()


def test_timeline_trim_snaps_edge_to_previous_clip_boundary():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{id:"v1",type:"video",name:"V1",items:[
                {id:"c1",kind:"clip",title:"Primero",start:0,end:2},
                {id:"c2",kind:"clip",title:"Segundo",start:3,end:5,sourceStart:0}
              ]}]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Primero'},index:0}}
        ))""")
        handle = page.locator(".cf-nle-block[data-item-id='c2'] .cf-nle-trim.left")
        handle.wait_for()
        box = handle.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - 16, y, steps=4)
        page.mouse.up()
        page.wait_for_function("""() => {
          const item = window.clipforgeEditorBridge.getProject().tracks[0].items.find(x => x.id === 'c2');
          return item && Math.abs(item.start - 2) < .001;
        }""")
        item = page.evaluate("() => window.clipforgeEditorBridge.getProject().tracks[0].items.find(x => x.id === 'c2')")
        assert item["start"] == 2
        assert item["end"] == 5
        browser.close()

def test_modifier_multi_select_moves_clips_as_a_group():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{id:"v1",type:"video",name:"V1",items:[
                {id:"c1",kind:"clip",title:"Uno",start:0,end:2},
                {id:"c2",kind:"clip",title:"Dos",start:3,end:5},
                {id:"c3",kind:"clip",title:"Tres",start:7,end:9}
              ]}]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Uno'},index:0}}
        ))""")
        blocks = page.locator(".cf-nle-block[data-type='video']")
        page.wait_for_function("() => document.querySelectorAll('.cf-nle-block[data-type=video]').length === 3")
        blocks.nth(0).click()
        blocks.nth(1).click(modifiers=["Control"])
        box = blocks.nth(0).bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 40, y, steps=4)
        page.mouse.up()
        page.wait_for_function("""() => {
          const items = window.clipforgeEditorBridge.getProject().tracks[0].items;
          return Math.abs(items.find(x => x.id === 'c1').start - 2) < .001 &&
                 Math.abs(items.find(x => x.id === 'c2').start - 5) < .001;
        }""")
        items = page.evaluate("() => window.clipforgeEditorBridge.getProject().tracks[0].items")
        assert abs(next(x for x in items if x["id"] == "c1")["start"] - 2) < .001
        assert abs(next(x for x in items if x["id"] == "c2")["start"] - 5) < .001
        assert next(x for x in items if x["id"] == "c3")["start"] == 7
        browser.close()

def test_editor_restores_source_and_imported_audio_from_indexeddb():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({projectName:"Restauración",tracks:[
                {id:"v1",type:"video",name:"V1",items:[
                  {id:"c1",kind:"clip",title:"Fuente",start:0,end:2,sourceStart:0,assetId:"source"}
                ]},
                {id:"a1",type:"audio",name:"A1",items:[
                  {id:"a1c1",kind:"audio",title:"Música",start:0,end:2,assetId:"audio-1",assetName:"musica.wav",url:"",missingAsset:true}
                ]}
              ]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""async () => {
          await window.clipforgeMediaStore.save("source", new Blob(["video-fixture"], {type:"video/mp4"}));
          await window.clipforgeMediaStore.save("audio-1", new Blob(["audio-fixture"], {type:"audio/wav"}));
          window.dispatchEvent(new CustomEvent(
            "clipforge:open-editor", {detail:{clip:{id:"c1",title:"Fuente"},index:0}}
          ));
        }""")
        page.wait_for_function("""() => {
          const p = window.clipforgeEditorBridge.getProject();
          const audio = p.tracks.find(t => t.type === "audio").items[0];
          return document.querySelector("#cfNleVideo")?.src?.startsWith("blob:") &&
                 audio?.url?.startsWith("blob:") && audio.missingAsset === false;
        }""", timeout=10000)
        state = page.evaluate("""() => {
          const p = window.clipforgeEditorBridge.getProject();
          return {
            source: document.querySelector("#cfNleVideo").src,
            audio: p.tracks.find(t => t.type === "audio").items[0]
          };
        }""")
        assert state["source"].startswith("blob:")
        assert state["audio"]["url"].startswith("blob:")
        assert state["audio"]["missingAsset"] is False
        browser.close()
