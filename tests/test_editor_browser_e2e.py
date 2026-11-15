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
        assert page.locator(".cf-nle-in
…[1 chars truncated — re-run with head/grep/tail for full output]…
ispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip uno'},index:0}}
        ))""")
        field = page.locator("#cfNleInspector input[data-k='start']")
        field.wait_for()
        field.fill("1.5")
        assert field.evaluate("(el) => el === document.activeElement")
        field.press("Tab")
        page.locator('[data-act="undo"]').click()
        assert page.locator("#cfNleInspector input[data-k='start']").input_value() == "0", 'undo failed'
        browser.close()


def test_text_overlay_can_be_dragged_in_preview():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[
                {id:"v1",type:"video",name:"V1",items:[{id:"c1",kind:"clip",title:"Clip",start:0,end:5,sourceStart:0}]},
                {id:"t1",type:"text",name:"T1",items:[{id:"tx1",kind:"text",text:"Mover texto",start:0,end:5,x:.5,y:.8,fontSize:32}]}
              ]}),
              setTracks: () => {}, setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip'},index:0}}
        ))""")
        caption = page.locator(".cf-nle-caption")
        caption.wait_for()
        before = caption.evaluate("(el) => el.style.left")
        box = caption.bounding_box()
        page.mouse.move(box["x"]+box["width"]/2, box["y"]+box["height"]/2)
        page.mouse.down()
        page.mouse.move(box["x"]+box["width"]/2+60, box["y"]+box["height"]/2+30)
        page.mouse.up()
        after = caption.evaluate("(el) => el.style.left")
        assert before != after
        browser.close()



def test_browser_export_mixes_original_audio_with_timeline_music_and_fades():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content('<button id="browserExportClips"></button><div id="browserExportStatus"></div>')
        page.add_script_tag(path=str(STATIC / "browser-export.js"))
        result = page.evaluate("""async () => {
          const makeTone = (name, amplitude) => {
            const rate = 48000, samples = rate, bytes = new ArrayBuffer(44 + samples * 2);
            const view = new DataView(bytes);
            const write = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
            write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE');
            write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
            view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
            view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data');
            view.setUint32(40, samples * 2, true);
            for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / rate) * amplitude * 32767, true);
            return new File([bytes], name, {type:'audio/wav'});
          };
          const source = makeTone('source.wav', .2);
          const music = makeTone('music.wav', .4);
          window.clipforgeMediaStore = {load: async id => id === 'music-1' ? music : null};
          const mixed = await window.clipforgeBuildTimelineAudioMix(
            source,
            {start:0,end:1},
            [{id:'a1',type:'audio',muted:false,items:[{
              id:'m1',kind:'audio',assetId:'music-1',start:0,end:1,sourceStart:0,
              volume:.5,fadeIn:.25,fadeOut:.25
            }]}],
            {id:'source-audio'},
            () => {}
          );
          const data = mixed.getChannelData(0);
          const rms = (from, to) => {
            let sum = 0, count = 0;
            for (let i = Math.floor(from * mixed.sampleRate); i < Math.floor(to * mixed.sampleRate); i++) {
              sum += data[i] * data[i]; count++;
            }
            return Math.sqrt(sum / count);
          };
          const muted = await window.clipforgeBuildTimelineAudioMix(source,{start:0,end:1},[{id:'v1',type:'video',muted:true,items:[{id:'source-clip',kind:'clip',assetId:'source',start:0,end:1}]}],{id:'source-audio'},()=>{});
          return {duration:mixed.duration, rate:mixed.sampleRate, early:rms(0,.05), middle:rms(.4,.6), late:rms(.95,1), mutedRms:Math.sqrt(muted.getChannelData(0).reduce((sum,value)=>sum+value*value,0)/muted.length)};
        }""")
        assert result["duration"] == 1
        assert result["rate"] == 48000
        assert result["middle"] > result["early"] * 1.35
        assert result["middle"] > result["late"] * 1.35
        assert result["mutedRms"] < 0.001
        browser.close()


def test_browser_export_composites_image_overlays_from_the_editor_timeline():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content('<button id="browserExportClips"></button><div id="browserExportStatus"></div>')
        page.add_script_tag(path=str(STATIC / "browser-export.js"))
        result = page.evaluate("""async () => {
          const source = new OffscreenCanvas(4,4);
          const sourceContext = source.getContext('2d');
          sourceContext.fillStyle = '#ff0000';
          sourceContext.fillRect(0,0,4,4);
          const imageBlob = await source.convertToBlob({type:'image/png'});
          window.clipforgeMediaStore = {load: async id => id === 'image-1' ? imageBlob : null};
          const layers = await window.clipforgeVisualOverlayTools.prepare(
            [{id:'v1',type:'video',items:[{
              id:'image-item',kind:'image',assetId:'image-1',start:0,end:1,
              positionX:0,positionY:0,scale:1,opacity:1
            }]}],
            {start:0,end:1}
          );
          const target = new OffscreenCanvas(100,100);
          const context = target.getContext('2d');
          await window.clipforgeVisualOverlayTools.draw(context,layers,.5,100,100);
          const pixel = [...context.getImageData(50,50,1,1).data];
          window.clipforgeVisualOverlayTools.dispose(layers);
          return pixel;
        }""")
        assert result[0] > 240 and result[1] < 10 and result[2] < 10 and result[3] > 240
        browser.close()



def test_muted_timeline_items_stay_silent_in_preview_and_export():
    source = (STATIC / "capcut-editor-enhancements.js").read_text()
    assert "if(i.muted||!i.url||time<Number(i.start)||time>=Number(i.end))return;" in source
    assert "const audios=items.filter(x=>x.track.type==='audio'&&!x.track.hidden&&!x.track.muted&&!x.item.muted);" in source
    assert "let g=(n.track?.muted||i.muted)?0:" in source
    assert "vv.muted=!!vt?.muted||!!activeVideoItem?.muted;" in source



def test_editor_inspector_exposes_per_item_mute_toggle():
    source = (STATIC / "capcut-editor-enhancements.js").read_text()
    assert "className='cf-nle-item-mute'" in source
    assert "mute.checked=!!item.muted" in source
    assert "window.clipforgeSetItemProperty?.(track.id,id,'muted',mute.checked)" in source
    assert "vv.muted=!!vt?.muted||!!activeVideoItem?.muted;" in source
    assert "if(i.muted||!i.url||time<Number(i.start)||time>=Number(i.end))return;" in source



def test_per_item_mute_checkbox_updates_saved_audio_item_state_in_chromium():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            const project = {tracks:[
              {id:"v1",type:"video",name:"V1",items:[
                {id:"v1i",kind:"clip",title:"Vídeo",start:0,end:5,sourceStart:0,assetId:"source"}
              ]},
              {id:"a1",type:"audio",name:"A1",items:[
                {id:"a1i",kind:"audio",title:"Música",start:0,end:5,sourceStart:0,url:"blob:audio-fixture"}
              ]}
            ]};
            window.clipforgeEditorBridge = {
              getProject: () => project,
              setTracks: (tracks) => { project.tracks = tracks; },
              setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'v1i',title:'Vídeo'},index:0}}
        ))""")
        audio_block = page.locator(".cf-nle-block[data-type='audio']")
        audio_block.wait_for()
        audio_block.click()
        mute = page.locator("#cfNleInspector input[data-item-mute='1']")
        mute.wait_for()
        assert not mute.is_checked()
        mute.check()
        assert page.evaluate("""() => window.clipforgeEditorBridge.getProject()
          .tracks.find(t => t.type === 'audio').items[0].muted""")
        browser.close()



def test_chromium_preview_renders_secondary_video_track_as_overlay():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section><div class="cf-opus-editor-slot"></div></section>
          <script>
            const project = {tracks:[
              {id:"v1",type:"video",name:"V1",items:[
                {id:"base",kind:"clip",title:"Base",start:0,end:5,sourceStart:0,assetId:"source"}
              ]},
              {id:"v2",type:"video",name:"V2",items:[
                {id:"overlay",kind:"image",title:"Overlay",start:0,end:5,
                 url:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='red'/%3E%3C/svg%3E",
                 opacity:.5,scale:1}
              ]},
              {id:"a1",type:"audio",name:"A1",items:[]}
            ]};
            window.clipforgeEditorBridge = {
              getProject: () => project,
              setTracks: tracks => { project.tracks = tracks; },
              setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'base',title:'Base'},index:0}}
        ))""")
        page.wait_for_selector("#cfNle")
        page.evaluate("() => window.dispatchEvent(new CustomEvent('clipforge:nle-changed'))")
        layer = page.locator(".cf-nle-visual-layers img[data-clipforge-layer='overlay']")
        layer.wait_for()
        assert layer.evaluate("(node) => node.style.opacity") == "0.5"
        assert page.locator(".cf-nle-visual-layers").count() == 1
        browser.close()



def test_preview_video_track_audio_respects_item_mute_volume_and_fades():
    source = (STATIC / "capcut-editor-enhancements.js").read_text()
    assert "node.muted=!!track.muted||!!item.muted" in source
    assert "node.volume=gain" in source
    assert "vv.muted=!!vt?.muted||!!activeVideoItem?.muted" in source
    assert "vv.volume=gain" in source
    assert "if(Number(activeVideoItem?.fadeIn)>0)" in source
    assert "if(Number(activeVideoItem?.fadeOut)>0)" in source



def test_editor_reports_missing_media_and_indexeddb_persistence_failures():
    source = (STATIC / "capcut-editor.js").read_text()
    assert "Recuperación de proyecto:" in source
    assert "medio(s) no encontrados" in source
    assert "no se pudo guardar para futuras sesiones" in source
    assert "storageFailures" in source
    assert "Seguirán disponibles solo hasta cerrar/recargar esta sesión" in source



def test_editor_workspace_has_capcut_style_three_panel_responsive_layout():
    source = (STATIC / "capcut-editor.js").read_text()
    assert "grid-template-columns:minmax(185px,225px) minmax(320px,1fr) minmax(260px,320px)" in source
    assert "height:clamp(520px,66vh,760px)" in source
    assert "cf-nle-transport" in source
    assert "@media(max-width:650px)" in source
    assert "#cfNle .cf-nle-track-head{position:sticky" in source


def test_timeline_mp4_export_control_remains_visible_and_clickable():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <button id="browserExportClips"></button>
          <script>
            window.clipforgeEditorBridge = {
              getProject: () => ({tracks:[{id:"v1",type:"video",name:"V1",items:[
                {id:"c1",kind:"clip",title:"Clip uno",start:0,end:2}
              ]}]}),
              setTracks: () => {}, setProjectName: () => {}
            };
            window.__exportButtonClicks = 0;
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip uno'},index:0}}
        ))""")
        export = page.locator("#cfNleExport")
        export.wait_for(state="visible", timeout=10000)
        assert export.is_visible()
        assert export.is_enabled()
        assert export.evaluate("(el) => getComputedStyle(el).display") != "none"
        browser.close()



def test_timeline_export_button_dispatches_to_browser_mp4_exporter():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <button id="browserExportClips"></button>
          <script>
            window.__exportButtonClicks = 0;
            document.querySelector("#browserExportClips").addEventListener(
              "click", () => window.__exportButtonClicks++
            );
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
        export = page.locator("#cfNleExport")
        export.wait_for(state="visible", timeout=10000)
        assert export.evaluate("(el) => typeof el.onclick") == "function"
        page.evaluate("""() => {
          window.__timelineExportCalls = 0;
          window.clipforgeExportTimeline = () => { window.__timelineExportCalls++; };
        }""")
        export.click()
        assert page.evaluate("window.__timelineExportCalls") == 1
        browser.close()


def test_keyframe_cannot_be_added_outside_selected_clip_bounds():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_content("""
          <input id="video" type="file">
          <section id="cfEditor"><div class="cf-opus-editor-slot"></div></section>
          <script>
            const project = {tracks:[{id:"v1",type:"video",name:"V1",items:[
              {id:"c1",kind:"clip",title:"Clip",start:2,end:5,sourceStart:0}
            ]}]};
            window.clipforgeEditorBridge = {
              getProject: () => project,
              setTracks: (tracks) => { project.tracks = tracks; },
              setProjectName: () => {}
            };
          </script>
        """)
        page.add_script_tag(path=str(STATIC / "capcut-editor.js"))
        page.add_script_tag(path=str(STATIC / "capcut-editor-enhancements.js"))
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'clipforge:open-editor', {detail:{clip:{id:'c1',title:'Clip'},index:0}}
        ))""")
        block = page.locator(".cf-nle-block[data-type='video']")
        block.wait_for()
        block.click()
        page.locator("#cfNleSeek").evaluate("el => { el.value='8'; el.dispatchEvent(new Event('input',{bubbles:true})); }")
        page.get_by_role("button", name="＋ Añadir fotograma clave").click()
        assert page.evaluate("() => window.clipforgeEditorBridge.getProject().tracks[0].items[0].keyframes || []") == []
        assert "dentro del clip" in page.locator("#cfNleStatus").inner_text()
        page.locator("#cfNleSeek").evaluate("el => { el.value='3'; el.dispatchEvent(new Event('input',{bubbles:true})); }")
        page.get_by_role("button", name="＋ Añadir fotograma clave").click()
        frames = page.evaluate("() => window.clipforgeEditorBridge.getProject().tracks[0].items[0].keyframes")
        assert len(frames) == 1
        assert frames[0]["time"] == 1
        browser.close()
