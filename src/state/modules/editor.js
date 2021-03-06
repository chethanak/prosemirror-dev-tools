import { EditorState } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import findNodeIn, { findNodeInJSON } from "../../utils/find-node";
import diffPatcher from "jsondiffpatch";
import { prettyPrint } from "html";

const HISTORY_SIZE = 200;

const diff = diffPatcher.create({
  arrays: { detectMove: false },
  textDiff: { minLength: 1 }
});

export function shrinkEditorHistory({ state, props }) {
  const { tr } = props;
  const skipHistory = tr.getMeta("_skip-dev-tools-history_");

  if (skipHistory) return;

  const startIndex = state.get("editor.historyRolledBackTo") !== false
    ? state.get("editor.historyRolledBackTo")
    : 0;

  const history = state.get("editor.history");
  state.set("editor.history", history.slice(startIndex, HISTORY_SIZE));
}

export function updateEditorHistory({ state, props }) {
  const { tr, newState } = props;
  const skipHistory = tr.getMeta("_skip-dev-tools-history_");

  if (skipHistory) return;

  const serializer = DOMSerializer.fromSchema(newState.schema);
  const domFragment = serializer.serializeFragment(
    newState.selection.content().content
  );

  let selectionContent = [];
  if (domFragment) {
    let child = domFragment.firstChild;
    while (child) {
      selectionContent.push(child.outerHTML);
      child = child.nextSibling;
    }
  }

  state.unshift("editor.history", {
    state: newState,
    timestamp: Date.now(),
    diff: diff.diff(
      state.get("editor.history")[0].state.doc.toJSON(),
      newState.doc.toJSON()
    ),
    selection: prettyPrint(selectionContent.join("\n"), {
      max_char: 60,
      indent_size: 2
    })
  });

  state.set("editor.selectedHistoryItem", 0);
  state.set("editor.historyRolledBackTo", false);
}

export function updateCurrentEditorState({ state, props }) {
  state.set("editor.state", props.newState);
}

export function selectHistoryItem({ state, props }) {
  state.set("editor.selectedHistoryItem", props.index);
}

export function rollbackHistory({ state, props }) {
  const { state: editorState } = state.get(`editor.history.${props.index}`);
  const editorView = state.get("editor.view");

  const newState = EditorState.create({
    schema: editorState.schema,
    plugins: editorState.plugins,
    doc: editorState.schema.nodeFromJSON(editorState.doc.toJSON())
  });

  editorView.updateState(newState);
  editorView.dom.focus();
  const tr = editorView.state.tr
    .setSelection(editorState.selection)
    .setMeta("addToHistory", false)
    .setMeta("_skip-dev-tools-history_", true);

  editorView.dispatch(tr);

  state.set("editor.state", newState);
  state.set("editor.historyRolledBackTo", props.index);
}

export function findPMNode(domNode) {
  let node;
  let target = domNode;

  while (!node && target) {
    if (target.pmViewDesc) {
      node = target;
    }
    target = target.parentNode;
  }

  return node;
}

export function findPMNodeInJSON(doc, node) {
  return findNodeInJSON(doc, node);
}

export function logNodeFromJSON({ state, props }) {
  const { doc, node } = props;
  const fullDoc = state.get("editor.state").doc;
  const path = findPMNodeInJSON(doc, node);
  if (path) {
    console.log(path.reduce((node, pathItem) => node[pathItem], fullDoc));
  } else {
    console.log(node);
  }
}

export function activatePicker({ state }) {
  function onMouseOver(e) {
    const node = findPMNode(e.target);

    if (
      node &&
      ((node.pmViewDesc.node && node.pmViewDesc.node.type.name !== "doc") ||
        node.pmViewDesc.mark)
    ) {
      const { top, left, width, height } = node.getBoundingClientRect();
      state.set("editor.nodePicker", {
        top: top + window.scrollY,
        left,
        width,
        height,
        onMouseOver,
        onClick
      });
    } else {
      state.set("editor.nodePicker", {
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        onMouseOver,
        onClick
      });
    }
  }

  function onClick(e) {
    e.preventDefault();
    document.removeEventListener("mouseover", onMouseOver);
    document.removeEventListener("click", onClick);

    const node = findPMNode(e.target);

    if (node) {
      const editorState = state.get("editor.state");
      const path = findNodeIn(
        editorState.doc,
        editorState.doc.nodeAt(node.pmViewDesc.posAtStart)
      );

      state.set("editor.expandPath", path);
      state.set("tabIndex", 0); // Switch to the "State" tab.
    }

    state.set("editor.nodePicker", { top: 0, left: 0, width: 0, height: 0 });
  }

  document.addEventListener("mouseover", onMouseOver);
  document.addEventListener("click", onClick);

  state.set("editor.nodePicker", {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    onMouseOver,
    onClick
  });
}

export function deactivatePicker({ state }) {
  const picker = state.get("editor.nodePicker");

  if (picker.onMouseOver) {
    document.removeEventListener("mouseover", picker.onMouseOver);
  }

  if (picker.onMouseOver) {
    document.removeEventListener("click", picker.onClick);
  }

  state.set("editor.nodePicker", { top: 0, left: 0, width: 0, height: 0 });
}

export default function createEditorModule(editorView) {
  return {
    state: {
      view: editorView,
      state: editorView.state,
      history: [{ state: editorView.state, timestamp: Date.now() }],
      selectedHistoryItem: 0,
      historyRolledBackTo: false,
      expandPath: [],
      nodePicker: { top: 0, left: 0, width: 0, height: 0 }
    },
    signals: {
      updated: [
        updateCurrentEditorState,
        [shrinkEditorHistory, updateEditorHistory]
      ],
      historyItemSelected: selectHistoryItem,
      historyRolledBack: rollbackHistory,
      pickerActivated: activatePicker,
      pickerDeactivated: deactivatePicker,
      JSONTreeNodeLogged: logNodeFromJSON
    }
  };
}
