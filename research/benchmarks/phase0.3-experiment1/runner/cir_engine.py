import re
import json
import yaml
from html.parser import HTMLParser

class CirNode:
    def __init__(self, cir_id, tag, attrs, parent_id=None):
        self.cir_id = cir_id
        self.tag = tag.lower()
        self.attrs = {k.lower(): v for k, v in attrs.items()} if attrs else {}
        self.parent_id = parent_id
        self.text = ""
        self.children = []
        self.role = self._determine_role()
        self.is_interactive = self._check_interactive()
        self.is_sensitive = self._check_sensitive()
        self.is_visible = not self._check_hidden()
        self.geometry = self._approx_geometry()
        self.state = self._extract_state()

    def _determine_role(self):
        if "role" in self.attrs:
            return self.attrs["role"]
        t = self.tag
        if t in ["button"]:
            return "button"
        if t in ["a"]:
            return "link"
        if t in ["input"]:
            itype = self.attrs.get("type", "text").lower()
            if itype in ["checkbox"]:
                return "checkbox"
            if itype in ["radio"]:
                return "radio"
            if itype in ["submit", "button", "reset"]:
                return "button"
            return "textbox"
        if t in ["select"]:
            return "combobox"
        if t in ["textarea"]:
            return "textbox"
        if t in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            return "heading"
        if t in ["table"]:
            return "table"
        if t in ["tr"]:
            return "row"
        if t in ["th", "td"]:
            return "cell"
        if t in ["nav"]:
            return "navigation"
        if t in ["article"]:
            return "article"
        if t in ["header"]:
            return "banner"
        if t in ["iframe"]:
            return "iframe"
        return "generic"

    def _check_interactive(self):
        if self.tag in ["button", "a", "input", "select", "textarea"]:
            return True
        if "onclick" in self.attrs or "cursor:pointer" in self.attrs.get("style", ""):
            return True
        if self.attrs.get("role") in ["button", "link", "checkbox", "tab"]:
            return True
        return False

    def _check_sensitive(self):
        t = self.attrs.get("type", "").lower()
        name = self.attrs.get("name", "").lower()
        cid = self.attrs.get("id", "").lower()
        auto = self.attrs.get("autocomplete", "").lower()
        if t == "password":
            return True
        if "cvv" in name or "cvv" in cid or "password" in name or "password" in cid:
            return True
        if "cc-number" in auto or "cc-csc" in auto:
            return True
        return False

    def _check_hidden(self):
        style = self.attrs.get("style", "").replace(" ", "").lower()
        if "display:none" in style or "visibility:hidden" in style:
            return True
        if "hidden" in self.attrs or self.attrs.get("aria-hidden") == "true":
            return True
        return False

    def _approx_geometry(self):
        # Deterministic synthetic layout coordinates
        idx = int(self.cir_id.replace("cir-", "")) if self.cir_id.startswith("cir-") else 1
        return {
            "x": 20 + (idx % 5) * 180,
            "y": 40 + (idx // 5) * 60,
            "w": 160,
            "h": 36
        }

    def _extract_state(self):
        st = {
            "enabled": not ("disabled" in self.attrs or self.attrs.get("aria-disabled") == "true")
        }
        if self.tag == "input" and self.attrs.get("type") in ["checkbox", "radio"]:
            st["checked"] = "checked" in self.attrs
        if self.is_sensitive:
            st["value"] = "[REDACTED]"
            st["isSensitive"] = True
        elif "value" in self.attrs:
            st["value"] = self.attrs["value"]
        return st

    def get_accessible_name(self):
        if "aria-label" in self.attrs:
            return self.attrs["aria-label"]
        if self.text.strip():
            return self.text.strip()
        if "placeholder" in self.attrs:
            return self.attrs["placeholder"]
        if "title" in self.attrs:
            return self.attrs["title"]
        if "alt" in self.attrs:
            return self.attrs["alt"]
        if "name" in self.attrs:
            return self.attrs["name"]
        if "id" in self.attrs:
            return self.attrs["id"]
        return ""

class CirHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.nodes = []
        self.counter = 0
        self.stack = []
        self.raw_html = ""

    def handle_starttag(self, tag, attrs):
        self.counter += 1
        cid = f"cir-{self.counter}"
        parent_id = self.stack[-1].cir_id if self.stack else None
        node = CirNode(cid, tag, dict(attrs), parent_id=parent_id)
        if self.stack:
            self.stack[-1].children.append(node)
        self.nodes.append(node)
        # Void elements do not go on stack
        if tag.lower() not in ["img", "input", "br", "hr", "meta", "link"]:
            self.stack.append(node)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1].tag == tag.lower():
            self.stack.pop()

    def handle_data(self, data):
        cleaned = data.strip()
        if cleaned and self.stack:
            curr = self.stack[-1]
            if curr.text:
                curr.text += " " + cleaned
            else:
                curr.text = cleaned

def extract_cir(html_content):
    parser = CirHTMLParser()
    parser.raw_html = html_content
    parser.feed(html_content)
    return parser.nodes

# -------------------------------------------------------------
# SERIALIZERS FOR THE 6 CANDIDATE REPRESENTATIONS
# -------------------------------------------------------------

def serialize_raw_html(nodes, raw_html):
    """Representation A: Raw / Serialized HTML."""
    return raw_html

def serialize_plain_text(nodes, raw_html):
    """Representation B: Plain Text / Semantic Text."""
    lines = []
    for n in nodes:
        if not n.is_visible:
            continue
        acc_name = n.get_accessible_name()
        if n.role in ["heading"]:
            lines.append(f"### {acc_name}")
        elif n.is_interactive:
            role_label = n.role.capitalize()
            states = []
            if not n.state.get("enabled", True):
                states.append("disabled")
            if n.state.get("checked"):
                states.append("checked")
            state_str = f" [{', '.join(states)}]" if states else ""
            lines.append(f"[{n.cir_id}] ({role_label}: {acc_name}){state_str}")
        elif n.tag in ["p", "span", "div"] and acc_name and len(acc_name) > 3 and not n.children:
            lines.append(acc_name)
    return "\n".join(lines)

def serialize_verbose_json(nodes, raw_html):
    """Representation C: Verbose SOM JSON."""
    items = []
    for n in nodes:
        if not n.is_visible and not n.is_interactive:
            continue
        item = {
            "cirId": n.cir_id,
            "role": n.role,
            "tag": n.tag,
            "name": n.get_accessible_name(),
            "interactive": n.is_interactive,
            "visible": n.is_visible,
            "bbox": [n.geometry["x"], n.geometry["y"], n.geometry["w"], n.geometry["h"]],
            "state": n.state,
            "parentId": n.parent_id
        }
        if n.tag == "a" and "href" in n.attrs:
            item["href"] = n.attrs["href"]
        if n.tag == "input" and "type" in n.attrs:
            item["inputType"] = n.attrs["type"]
        items.append(item)
    return json.dumps(items, indent=2)

def serialize_indented_yaml(nodes, raw_html):
    """Representation D: Indented YAML SOM."""
    items = []
    for n in nodes:
        if not n.is_visible and not n.is_interactive:
            continue
        d = {
            "id": n.cir_id,
            "role": n.role,
            "name": n.get_accessible_name(),
            "box": [n.geometry["x"], n.geometry["y"], n.geometry["w"], n.geometry["h"]]
        }
        if not n.state.get("enabled", True):
            d["disabled"] = True
        if n.state.get("checked"):
            d["checked"] = True
        if n.state.get("isSensitive"):
            d["sensitive"] = True
        items.append(d)
    return yaml.dump(items, sort_keys=False)

def serialize_compact_tuple(nodes, raw_html):
    """Representation E: Compact Columnar Tuple SOM."""
    lines = []
    for n in nodes:
        if not n.is_visible and not n.is_interactive:
            continue
        g = n.geometry
        name = n.get_accessible_name()
        # Truncate long text
        if len(name) > 40:
            name = name[:37] + "..."
        states = []
        if not n.state.get("enabled", True):
            states.append("disabled")
        if n.state.get("checked"):
            states.append("checked")
        if n.state.get("isSensitive"):
            states.append("secret")
        state_str = f" [{','.join(states)}]" if states else ""
        lines.append(f"[{n.cir_id}] {n.role} \"{name}\" ({g['x']},{g['y']},{g['w']},{g['h']}){state_str}")
    return "\n".join(lines)

def serialize_aria_tree(nodes, raw_html):
    """Representation F: Synthetic ARIA Semantic Accessibility Tree."""
    lines = []
    for n in nodes:
        if not n.is_visible and not n.is_interactive:
            continue
        name = n.get_accessible_name()
        role = n.role
        states = []
        if n.is_interactive:
            states.append("focusable")
        if not n.state.get("enabled", True):
            states.append("disabled")
        if n.state.get("checked"):
            states.append("checked")
        state_str = f", states: [{', '.join(states)}]" if states else ""
        parent_indent = "  " if n.parent_id else ""
        lines.append(f"{parent_indent}[{n.cir_id}] role: {role}, name: \"{name}\"{state_str}")
    return "\n".join(lines)

REPRESENTATIONS = {
    "A_raw_html": serialize_raw_html,
    "B_plain_text": serialize_plain_text,
    "C_verbose_json": serialize_verbose_json,
    "D_indented_yaml": serialize_indented_yaml,
    "E_compact_tuple": serialize_compact_tuple,
    "F_aria_tree": serialize_aria_tree
}

