#!/usr/bin/env python3
from __future__ import annotations

import functools
import json
import os
import sys
from collections import Counter
from typing import Any, Dict, List, Optional, Set, Tuple

from langchain_core.messages import HumanMessage, SystemMessage  # type: ignore
from langchain_openai import ChatOpenAI  # type: ignore

from canvas_context import build_canvas_context_for_llm, load_planner_schema


FLOWY_DEEPAGENTS_DIR = os.path.join(os.path.dirname(__file__), "")


@functools.lru_cache(maxsize=1)
def _planner_allowlists() -> Tuple[Set[str], Set[str], Set[str]]:
    """Allowlists from src/lib/flowy/planner_schema.json (repo root relative)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    schema = load_planner_schema(script_dir)
    nodes = set(str(x) for x in (schema.get("nodeTypes") or []))
    handles = set(str(x) for x in (schema.get("handleTypes") or []))
    ops = set(str(x) for x in (schema.get("operationTypes") or []))
    if not nodes or not handles or not ops:
        raise ValueError("planner_schema.json missing nodeTypes, handleTypes, or operationTypes")
    return nodes, handles, ops


def _read_stdin_json() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def _safe_extract_first_json_object(text: str) -> Dict[str, Any]:
    if not text:
        return {}
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    snippet = text[start : end + 1]
    try:
        return json.loads(snippet)
    except Exception:
        # If the snippet isn't valid JSON, return empty so the caller can
        # respond with invalid_json_or_empty instead of crashing.
        return {}


def _validate_edge_handles(source_handle: Optional[str], target_handle: Optional[str]) -> Optional[str]:
    allowed_handles = _planner_allowlists()[1]
    if not source_handle and not target_handle:
        return "Edge handles must be provided (sourceHandle and targetHandle)."
    if source_handle not in allowed_handles:
        return f"Invalid sourceHandle '{source_handle}'."
    if target_handle not in allowed_handles:
        return f"Invalid targetHandle '{target_handle}'."

    # Matching rule (except 'reference'): connect handle types by equality.
    if source_handle == "reference" or target_handle == "reference":
        return None
    if source_handle != target_handle:
        return f"Handle mismatch: {source_handle} -> {target_handle}."
    return None


def _validate_edit_operations(operations: List[Dict[str, Any]], workflow_state: Dict[str, Any]) -> Dict[str, Any]:
    errors: List[str] = []
    allowed_nodes, _handles, allowed_ops = _planner_allowlists()

    if not isinstance(operations, list):
        return {"ok": False, "errors": ["operations must be a list"]}

    initial_nodes = workflow_state.get("nodes") or []
    initial_edges = workflow_state.get("edges") or []

    initial_node_ids = {n.get("id") for n in initial_nodes if isinstance(n, dict) and n.get("id")}
    initial_edge_ids = {e.get("id") for e in initial_edges if isinstance(e, dict) and e.get("id")}

    added_node_ids: set[str] = set()
    for op in operations:
        if not isinstance(op, dict):
            continue
        if op.get("type") == "addNode" and op.get("nodeId"):
            added_node_ids.add(op["nodeId"])

    valid_node_ids = initial_node_ids | added_node_ids

    for idx, op in enumerate(operations):
        if not isinstance(op, dict):
            errors.append(f"operations[{idx}] must be an object")
            continue

        op_type = op.get("type")
        if op_type not in allowed_ops:
            errors.append(f"operations[{idx}].type invalid: {op_type}")
            continue

        if op_type == "addNode":
            node_type = op.get("nodeType")
            node_id = op.get("nodeId")
            if node_type not in allowed_nodes:
                errors.append(f"operations[{idx}].nodeType invalid: {node_type}")
            if not node_id or not isinstance(node_id, str):
                errors.append(f"operations[{idx}].nodeId is required for subsequent ops (missing).")

        if op_type == "removeNode":
            node_id = op.get("nodeId")
            if not node_id or node_id not in valid_node_ids:
                errors.append(f"operations[{idx}].nodeId not found: {node_id}")

        if op_type == "updateNode":
            node_id = op.get("nodeId")
            if not node_id or node_id not in valid_node_ids:
                errors.append(f"operations[{idx}].nodeId not found: {node_id}")
            data = op.get("data")
            if not isinstance(data, dict):
                errors.append(f"operations[{idx}].data must be an object")

        if op_type == "addEdge":
            source = op.get("source")
            target = op.get("target")
            if not source or source not in valid_node_ids:
                errors.append(f"operations[{idx}].source nodeId not found: {source}")
            if not target or target not in valid_node_ids:
                errors.append(f"operations[{idx}].target nodeId not found: {target}")

            sh = op.get("sourceHandle")
            th = op.get("targetHandle")
            handle_error = _validate_edge_handles(sh, th)
            if handle_error:
                errors.append(f"operations[{idx}] edge handle error: {handle_error}")

        if op_type == "removeEdge":
            edge_id = op.get("edgeId")
            if not edge_id or edge_id not in initial_edge_ids:
                errors.append(f"operations[{idx}].edgeId not found: {edge_id}")

    return {"ok": not errors, "errors": errors}


def _validate_toolbar_intent_plan(
    message: str, parsed: Dict[str, Any], operations: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Validate that common toolbar requests are expressed with the expected
    operation pattern so the UI can apply them deterministically.
    """
    errors: List[str] = []
    msg = (message or "").lower()

    add_nodes = [op for op in operations if isinstance(op, dict) and op.get("type") == "addNode"]
    add_edges = [op for op in operations if isinstance(op, dict) and op.get("type") == "addEdge"]
    update_nodes = [op for op in operations if isinstance(op, dict) and op.get("type") == "updateNode"]
    execute_ids = parsed.get("executeNodeIds")
    execute_ids_list = execute_ids if isinstance(execute_ids, list) else []

    asks_upscale = "upscale" in msg
    asks_grid = "split into grid" in msg or ("grid" in msg and "split" in msg)
    asks_extract_frame = "extract frame" in msg or ("frame" in msg and "video" in msg)
    # Keep this explicit to avoid false positives on generic "model" mentions.
    asks_model_tune = any(
        k in msg
        for k in [
            "change model",
            "switch model",
            "set model",
            "change provider",
            "set provider",
            "aspect ratio",
            "resolution",
            "temperature",
            "max tokens",
            "parameters",
        ]
    )
    asks_ease = any(k in msg for k in ["ease curve", "bezier", "easing", "output duration"])
    asks_switch_rules = (
        "conditional switch" in msg
        or "switch rules" in msg
        or "edit rules" in msg
    )

    if asks_upscale:
        has_upscale_add = any(op.get("nodeType") == "generateImage" for op in add_nodes)
        has_image_edge = any(
            op.get("sourceHandle") == "image" and op.get("targetHandle") == "image"
            for op in add_edges
        )
        if not has_upscale_add:
            errors.append("Upscale request must add a generateImage node.")
        if not has_image_edge:
            errors.append("Upscale request must connect image -> image edge.")
        if len(execute_ids_list) == 0:
            errors.append("Upscale request must include executeNodeIds for the new node.")

    if asks_grid:
        media_adds = [op for op in add_nodes if op.get("nodeType") == "mediaInput"]
        ref_edges = [
            op
            for op in add_edges
            if op.get("targetHandle") == "reference"
        ]
        if len(media_adds) < 2:
            errors.append("Split-grid request should add multiple mediaInput nodes.")
        if len(ref_edges) < 2:
            errors.append("Split-grid request should add reference edges to grid nodes.")

    if asks_extract_frame:
        has_media_add = any(op.get("nodeType") == "mediaInput" for op in add_nodes)
        has_reference_edge = any(op.get("targetHandle") == "reference" for op in add_edges)
        if not has_media_add:
            errors.append("Extract-frame request must add a mediaInput node.")
        if not has_reference_edge:
            errors.append("Extract-frame request must add a reference edge to the frame node.")

    if asks_model_tune and len(update_nodes) == 0:
        errors.append("Model/settings request should include updateNode operations.")

    if asks_ease:
        touched_ease = any(
            isinstance(op.get("data"), dict)
            and any(k in op.get("data", {}) for k in ["bezierHandles", "easingPreset", "outputDuration"])
            for op in update_nodes
        )
        if not touched_ease:
            errors.append(
                "Ease-curve request should update bezierHandles/easingPreset/outputDuration via updateNode."
            )

    if asks_switch_rules:
        touched_rules = any(
            isinstance(op.get("data"), dict) and "rules" in op.get("data", {})
            for op in update_nodes
        )
        if not touched_rules:
            errors.append("Conditional-switch rule request should update rules via updateNode.")

    return {"ok": not errors, "errors": errors}


def _read_text_file(rel_path: str) -> str:
    abs_path = os.path.join(FLOWY_DEEPAGENTS_DIR, rel_path)
    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _build_system_prompt() -> str:
    # AGENTS.md already contains the hard "JSON only" rule.
    agents_md = _read_text_file("AGENTS.md").strip()
    skill_md = _read_text_file(os.path.join("skills", "flowy-plan", "SKILL.md")).strip()
    if skill_md:
        return agents_md + "\n\nSkill:\n" + skill_md
    return agents_md


def _build_workflow_brief_for_router(
    workflow_state: Dict[str, Any], selected_node_ids: List[str]
) -> Dict[str, Any]:
    """Small summary for intent routing (no heavy node data)."""
    nodes = [n for n in (workflow_state.get("nodes") or []) if isinstance(n, dict)]
    edges = [e for e in (workflow_state.get("edges") or []) if isinstance(e, dict)]
    types = [str(n.get("type") or "unknown") for n in nodes]
    type_counts: Dict[str, int] = dict(Counter(types).most_common(24))
    sample: List[Dict[str, Any]] = []
    for n in nodes[:56]:
        nid = n.get("id")
        if nid:
            sample.append({"id": str(nid), "type": n.get("type")})
    groups = workflow_state.get("groups")
    group_count = len(groups) if isinstance(groups, dict) else 0
    return {
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "groupCount": group_count,
        "selectedNodeIds": list(selected_node_ids),
        "nodeTypeCounts": type_counts,
        "nodesSample": sample,
        "nodesSampleIsPartial": len(nodes) > len(sample),
    }


def _classify_user_intent(
    router_model: Any,
    message: str,
    workflow_state: Dict[str, Any],
    selected_node_ids: List[str],
) -> Optional[Dict[str, Any]]:
    """
    LLM router: conversation vs canvas_edit.
    Returns None if routing should be skipped / failed (caller falls back to planning).
    """
    msg = (message or "").strip()
    if not msg:
        return None

    router_md = _read_text_file("ROUTER.md").strip()
    if not router_md:
        return None

    brief = _build_workflow_brief_for_router(workflow_state, selected_node_ids)
    user = (
        f"UserMessage:\n{msg}\n\nWorkflowBrief (JSON):\n"
        f"{json.dumps(brief, ensure_ascii=False)}\n\nReturn ONLY the JSON object."
    )
    try:
        resp = router_model.invoke(
            [SystemMessage(content=router_md), HumanMessage(content=user)],
            response_format={"type": "json_object"},
        )
    except Exception:
        return None

    raw = str(getattr(resp, "content", "") or "")
    try:
        data = json.loads(raw)
    except Exception:
        data = _safe_extract_first_json_object(raw)
    if not isinstance(data, dict):
        return None

    intent = str(data.get("intent") or "").strip().lower()
    reply = data.get("reply")
    if intent not in {"conversation", "canvas_edit"}:
        return None
    out: Dict[str, Any] = {"intent": intent, "reason": data.get("reason")}
    if isinstance(reply, str):
        out["reply"] = reply
    return out


def _build_user_prompt(
    message: str,
    workflow_state: Dict[str, Any],
    selected_node_ids: List[str],
    *,
    closing_instruction: str,
) -> str:
    try:
        hops = int(os.environ.get("FLOWY_CONTEXT_NEIGHBOR_HOPS", "2"))
    except ValueError:
        hops = 2
    try:
        focus_max = int(os.environ.get("FLOWY_CONTEXT_FOCUS_MAX_NODES", "72"))
    except ValueError:
        focus_max = 72

    canvas_ctx = build_canvas_context_for_llm(
        workflow_state,
        selected_node_ids=selected_node_ids,
        neighbor_hops=hops,
        focus_max_nodes=focus_max,
    )
    canvas_json = json.dumps(canvas_ctx, ensure_ascii=False, indent=2)

    return (
        f"Message: {message}\n\n"
        "Current workflow (JSON). Use nodesDetailed for full context near the user's selection; "
        "nodesOutline lists other nodes by id/type only; edges are the full graph.\n"
        f"{canvas_json}\n\n"
        f"{closing_instruction}"
    )


CLOSE_CANVAS_PLAN = "Return the planned edit operations as a single JSON object."

CLOSE_PLAN_ADVISOR = (
    "MODE: CHAT (advisory only). Do not output edit operations or claim the canvas changed.\n"
    'Return ONLY valid JSON: {"assistantText":"..."} — a single string with your full answer.'
)


def _run_plan_advisor_only(
    model: Any,
    message: str,
    workflow_state: Dict[str, Any],
    selected_node_ids: List[str],
) -> str:
    advisor = _read_text_file("PLAN_ADVISOR.md").strip()
    if not advisor:
        advisor = "You are a workflow chat advisor. Advise only; do not claim canvas edits."
    system_prompt = advisor + "\n\nReturn ONLY JSON: {\"assistantText\": \"...\"}."
    user_prompt = _build_user_prompt(
        message,
        workflow_state,
        selected_node_ids,
        closing_instruction=CLOSE_PLAN_ADVISOR,
    )
    resp = model.invoke(
        [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)],
        response_format={"type": "json_object"},
    )
    raw = str(getattr(resp, "content", "") or "")
    try:
        data = json.loads(raw)
    except Exception:
        data = _safe_extract_first_json_object(raw)
    if isinstance(data, dict):
        text = data.get("assistantText")
        if isinstance(text, str) and text.strip():
            return text.strip()
    return (
        "I can help you design that workflow step by step. "
        "Tell me your goal (e.g. image → video) and any constraints (models, style, length)."
    )


def main() -> None:
    try:
        payload = _read_stdin_json()
        message = payload.get("message") or ""
        workflow_state = payload.get("workflowState") or {"nodes": [], "edges": []}
        selected_node_ids = payload.get("selectedNodeIds") or []
        agent_mode = str(payload.get("agentMode") or "assist").strip().lower()
        if agent_mode not in {"plan", "assist", "auto"}:
            agent_mode = "assist"

        openai_key = os.environ.get("OPENAI_API_KEY")
        if not openai_key:
            sys.stdout.write(
                json.dumps(
                    {
                        "ok": False,
                        "error": "OPENAI_API_KEY missing; cannot run deep planner.",
                        "assistantText": "Deep planner unavailable (missing OPENAI_API_KEY).",
                        "operations": [],
                        "requiresApproval": False,
                        "approvalReason": "",
                        "runApprovalRequired": agent_mode == "assist",
                    }
                )
            )
            return

        planner_model_name = os.environ.get("FLOWY_PLANNER_MODEL", "gpt-4.1-mini")
        router_model_name = os.environ.get("FLOWY_ROUTER_MODEL", planner_model_name)

        model = ChatOpenAI(
            api_key=openai_key,
            model=planner_model_name,
            temperature=0.2,
        )
        router_model = ChatOpenAI(
            api_key=openai_key,
            model=router_model_name,
            temperature=0.1,
        )

        if agent_mode == "plan":
            text = _run_plan_advisor_only(model, message, workflow_state, selected_node_ids)
            sys.stdout.write(
                json.dumps(
                    {
                        "ok": True,
                        "mode": "chat",
                        "assistantText": text,
                        "operations": [],
                        "requiresApproval": False,
                        "approvalReason": "",
                        "runApprovalRequired": False,
                        "agentMode": "plan",
                    }
                )
            )
            return

        skip_router = os.environ.get("FLOWY_SKIP_INTENT_ROUTER", "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        if agent_mode == "auto":
            skip_router = True
        if not skip_router:
            route = _classify_user_intent(router_model, message, workflow_state, selected_node_ids)
            if route and route.get("intent") == "conversation":
                reply_text = route.get("reply")
                if not isinstance(reply_text, str) or not reply_text.strip():
                    reply_text = (
                        "Here’s a quick answer. If you want me to change the canvas, say what to add, "
                        "connect, or run."
                    )
                sys.stdout.write(
                    json.dumps(
                        {
                            "ok": True,
                            "mode": "chat",
                            "assistantText": reply_text.strip(),
                            "operations": [],
                            "requiresApproval": False,
                            "approvalReason": "",
                            "runApprovalRequired": False,
                        }
                    )
                )
                return

        system_prompt = _build_system_prompt()

        parsed: Dict[str, Any] = {}
        validated_ok = False
        last_errors: List[str] = []
        last_text_debug: str = ""

        for attempt in range(3):
            user_prompt = _build_user_prompt(
                message,
                workflow_state,
                selected_node_ids,
                closing_instruction=CLOSE_CANVAS_PLAN,
            )
            if attempt > 0 and last_errors:
                user_prompt += (
                    "\n\nYour previous operations were invalid:\n"
                    + "\n".join(f"- {e}" for e in last_errors)
                    + "\n\nReturn ONLY corrected JSON."
                )
            # JSON mode guarantees parseable JSON output (we still validate shape below).
            resp = model.invoke(
                [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)],
                response_format={"type": "json_object"},
            )
            last_text = str(getattr(resp, "content", "") or "")
            last_text_debug = last_text[:2000] if last_text else ""

            try:
                candidate = json.loads(last_text)
                if not isinstance(candidate, dict):
                    candidate = _safe_extract_first_json_object(last_text)
            except Exception:
                candidate = _safe_extract_first_json_object(last_text)

            if not candidate:
                parsed = {}
                last_errors = ["LLM did not return valid JSON."]
                continue

            operations = candidate.get("operations", [])
            validation = _validate_edit_operations(operations, workflow_state)
            toolbar_validation = _validate_toolbar_intent_plan(message, candidate, operations)
            combined_errors = [
                *(validation.get("errors") or []),
                *(toolbar_validation.get("errors") or []),
            ]
            if validation.get("ok") and toolbar_validation.get("ok"):
                parsed = candidate
                validated_ok = True
                break

            parsed = candidate
            last_errors = combined_errors or ["validation_failed"]

        ok = validated_ok
        if not parsed:
            parsed = {
                "assistantText": "Deep planner failed to produce valid JSON.",
                "operations": [],
                "requiresApproval": True,
                "approvalReason": "Planning failed.",
                "error": "invalid_json_or_empty",
                "debugLastText": last_text_debug,
            }
        elif not validated_ok:
            parsed = {
                "assistantText": parsed.get("assistantText", "Planning failed."),
                "operations": parsed.get("operations", []),
                "requiresApproval": True,
                "approvalReason": "Planning failed validation. User approval needed or adjust constraints.",
                "error": "validation_failed",
                "debugLastText": last_text_debug,
                "validationErrors": last_errors,
            }

        out: Dict[str, Any] = {
            "ok": ok,
            "mode": "plan",
            "assistantText": parsed.get("assistantText", ""),
            "operations": parsed.get("operations", []),
            # Canvas edits are always auto-applied (Assist + Auto). Approval only gates execution.
            "requiresApproval": False,
            "approvalReason": "",
            "agentMode": agent_mode,
        }
        # Always include debug so the UI can show what the model returned.
        out["debugLastText"] = last_text_debug
        if parsed.get("executeNodeIds") is not None:
            out["executeNodeIds"] = parsed.get("executeNodeIds")
        # Execution approval is mode-driven:
        # - Assist: wait for user approval before running nodes/workflows.
        # - Auto: run automatically.
        out["runApprovalRequired"] = agent_mode == "assist"
        if not ok:
            out["error"] = parsed.get("error", "deep_agent_planning_failed")

        sys.stdout.write(json.dumps(out))
    except Exception as e:
        sys.stdout.write(
            json.dumps(
                {
                    "ok": False,
                    "error": f"Deep planner crashed: {e}",
                    "assistantText": "Deep planner crashed. Try again.",
                    "operations": [],
                    "requiresApproval": False,
                    "approvalReason": "",
                    "runApprovalRequired": False,
                    "debugLastText": (locals().get("last_text_debug") or "")[:2000],
                }
            )
        )


if __name__ == "__main__":
    main()

