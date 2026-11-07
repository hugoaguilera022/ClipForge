import json
import pytest
from project_store import ProjectError, load_project, list_projects, save_project

def valid_project():
    return {
        "schema": "clipforge-project-v2",
        "source": "resistencia.mp4",
        "transcript": {"segments": [{"start": 0, "end": 1, "text": "Hola"}]},
        "clips": [{"id": "clip-1", "start": 0, "end": 5, "text": "Hola"}],
        "tracks": [{"id": "v1", "type": "video", "name": "Vídeo",
                    "items": [{"start": 0, "end": 5, "text": "Clip"}]}]
    }

def test_save_load_roundtrip(tmp_path):
    saved = save_project(tmp_path, "a1b2c3d4e5f6", valid_project())
    loaded = load_project(tmp_path, "a1b2c3d4e5f6")
    assert saved["clip_count"] == 1
    assert loaded["clips"][0]["text"] == "Hola"
    assert loaded["tracks"][0]["items"][0]["end"] == 5

def test_list_projects_ignores_corrupt_files(tmp_path):
    save_project(tmp_path, "a1b2c3d4e5f6", valid_project())
    (tmp_path / "b1b2b2b2b2b2.json").write_text("{broken", encoding="utf-8")
    assert [p["id"] for p in list_projects(tmp_path)] == ["a1b2c3d4e5f6"]

@pytest.mark.parametrize("bad_id", ["../etc/passwd", "not-an-id", ""])
def test_rejects_unsafe_project_id(tmp_path, bad_id):
    with pytest.raises(ProjectError):
        save_project(tmp_path, bad_id, valid_project())

def test_rejects_invalid_clip_times(tmp_path):
    project = valid_project()
    project["clips"][0]["end"] = -1
    with pytest.raises(ProjectError):
        save_project(tmp_path, "a1b2c3d4e5f6", project)

def test_rejects_unknown_track_type(tmp_path):
    project = valid_project()
    project["tracks"][0]["type"] = "shell"
    with pytest.raises(ProjectError):
        save_project(tmp_path, "a1b2c3d4e5f6", project)

def test_atomic_save_replaces_previous_version(tmp_path):
    save_project(tmp_path, "a1b2c3d4e5f6", valid_project())
    project = valid_project()
    project["clips"][0]["text"] = "Editado"
    save_project(tmp_path, "a1b2c3d4e5f6", project)
    assert load_project(tmp_path, "a1b2c3d4e5f6")["clips"][0]["text"] == "Editado"
    assert not list(tmp_path.glob("*.tmp"))
