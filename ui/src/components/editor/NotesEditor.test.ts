import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import NotesEditor from "./NotesEditor.vue";

vi.mock("@/api.js", () => ({
  addNote: vi.fn(() => Promise.resolve({ id: "n_new", text: "x", at: "2026-06-06T00:00:00Z" })),
  editNote: vi.fn(() => Promise.resolve({})),
  deleteNote: vi.fn(() => Promise.resolve({})),
}));

import { addNote, editNote, deleteNote } from "@/api.js";

const NOTES = [{ id: "n_1", text: "Legal signed off", at: "2026-05-01T09:00:00Z" }];

describe("NotesEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders existing notes and the never-sent hint", () => {
    const w = mount(NotesEditor, { props: { keyName: "k", notes: NOTES } });
    expect(w.text()).toContain("Legal signed off");
    expect(w.text()).toContain("never sent to the AI");
  });

  it("adds a note via the api and emits changed", async () => {
    const w = mount(NotesEditor, { props: { keyName: "k", notes: [] } });
    await w.get('[data-testid="new-note"]').setValue("Do not shorten");
    await w.get('[data-testid="add-note"]').trigger("click");
    await flushPromises();
    expect(addNote).toHaveBeenCalledWith("k", "Do not shorten");
    expect(w.emitted("changed")).toBeTruthy();
  });

  it("deletes a note via the api and emits changed", async () => {
    const w = mount(NotesEditor, { props: { keyName: "k", notes: NOTES } });
    await w.get('[aria-label="Delete note"]').trigger("click");
    await flushPromises();
    expect(deleteNote).toHaveBeenCalledWith("k", "n_1");
    expect(w.emitted("changed")).toBeTruthy();
  });

  it("edits a note via the api and emits changed", async () => {
    const w = mount(NotesEditor, { props: { keyName: "k", notes: NOTES } });
    await w.get('[aria-label="Edit note"]').trigger("click");
    await w.findAll("textarea")[0]!.setValue("Updated note");
    await w.findAll("button").find((b) => b.text() === "Save")!.trigger("click");
    await flushPromises();
    expect(editNote).toHaveBeenCalledWith("k", "n_1", "Updated note");
    expect(w.emitted("changed")).toBeTruthy();
  });

  it("does not call addNote when the draft is blank", async () => {
    const w = mount(NotesEditor, { props: { keyName: "k", notes: [] } });
    await w.get('[data-testid="add-note"]').trigger("click");
    await flushPromises();
    expect(addNote).not.toHaveBeenCalled();
    expect(w.emitted("changed")).toBeFalsy();
  });

  it("cancelling an edit does not call editNote or emit", async () => {
    const w = mount(NotesEditor, { props: { keyName: "k", notes: NOTES } });
    await w.get('[aria-label="Edit note"]').trigger("click");
    await w.findAll("button").find((b) => b.text() === "Cancel")!.trigger("click");
    await flushPromises();
    expect(editNote).not.toHaveBeenCalled();
    expect(w.emitted("changed")).toBeFalsy();
  });
});
