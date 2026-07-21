import json
import pathlib
import re
import struct
import unittest


WEB_ROOT = pathlib.Path(__file__).resolve().parents[1]
INVITE_FUNCTION = WEB_ROOT.parent / "supabase" / "functions" / "invite-employee" / "index.ts"


class PwaStaticTests(unittest.TestCase):
    def test_manifest_and_referenced_shell_files_exist(self):
        manifest = json.loads((WEB_ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        self.assertTrue(manifest["icons"])
        png_sizes = {
            icon["sizes"]
            for icon in manifest["icons"]
            if icon.get("type") == "image/png" and icon.get("purpose") == "any"
        }
        self.assertTrue({"192x192", "512x512"}.issubset(png_sizes))
        for relative_path in (
            "index.html",
            "styles.css",
            "app.js",
            "api.js",
            "analytics.js",
            "demo-data.js",
            "config.js",
            "service-worker.js",
            "icons/icon.svg",
            "icons/icon-180.png",
            "icons/icon-192.png",
            "icons/icon-512.png",
        ):
            self.assertTrue((WEB_ROOT / relative_path).is_file(), relative_path)
        for filename, expected_size in (("icon-180.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
            image = (WEB_ROOT / "icons" / filename).read_bytes()
            self.assertEqual(image[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(struct.unpack(">II", image[16:24]), (expected_size, expected_size))

    def test_public_web_files_contain_no_service_role_secret(self):
        public_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in WEB_ROOT.rglob("*")
            if path.is_file() and path.suffix.lower() in {".html", ".js", ".json", ".webmanifest"}
        ).lower()
        self.assertNotIn("service_role", public_text)
        self.assertNotIn("supabase_service_role_key", public_text)

    def test_service_worker_only_handles_get_same_origin_shell_requests(self):
        worker = (WEB_ROOT / "service-worker.js").read_text(encoding="utf-8")
        self.assertIn('request.method !== "GET"', worker)
        self.assertIn("url.origin !== SCOPE_URL.origin", worker)
        self.assertIn("if (!SHELL_URLS.has(normalizedUrl)) return", worker)
        self.assertIn("await cache.put(cacheKey, response.clone())", worker)
        self.assertIn("event.respondWith(networkFirst(request, INDEX_URL))", worker)
        self.assertNotRegex(worker, re.compile(r"rest/v1|auth/v1|functions/v1", re.I))

    def test_stale_confirmation_is_sent_to_the_review_rpc(self):
        api = (WEB_ROOT / "api.js").read_text(encoding="utf-8")
        self.assertIn("p_confirm_stale: confirmStale", api)

    def test_owner_sees_proposed_cost_for_add_ingredient_requests(self):
        app = (WEB_ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('request.change_type !== "add_ingredient"', app)
        self.assertGreaterEqual(app.count("Proposed unit cost"), 2)
        self.assertIn("money(request.proposed_unit_cost, currency())", app)

    def test_sale_retries_reuse_one_idempotency_key_per_modal(self):
        api = (WEB_ROOT / "api.js").read_text(encoding="utf-8")
        app = (WEB_ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("p_client_command_id: clientCommandId", api)
        self.assertIn("const clientCommandId = createCommandId()", app)
        self.assertIn("form.get(\"note\"), clientCommandId", app)

    def test_employee_documents_use_the_safe_rpc_not_the_raw_table(self):
        api = (WEB_ROOT / "api.js").read_text(encoding="utf-8")
        self.assertIn('this.rpc("get_business_documents", { p_business_id: businessId })', api)
        self.assertNotIn("business_documents?select=", api)

    def test_exact_sales_and_activity_are_paginated(self):
        api = (WEB_ROOT / "api.js").read_text(encoding="utf-8")
        self.assertIn("async restPages", api)
        self.assertIn("this.restPages(`sales?", api)
        self.assertIn("this.restPages(`sale_financials?", api)
        self.assertIn("this.restPages(`audit_events?", api)
        self.assertNotIn("limit=500", api)

    def test_owner_analytics_has_exact_product_employee_and_day_breakdowns(self):
        analytics = (WEB_ROOT / "analytics.js").read_text(encoding="utf-8")
        app = (WEB_ROOT / "app.js").read_text(encoding="utf-8")
        for key in ("byProduct", "byEmployee", "byDay"):
            self.assertIn(key, analytics)
            self.assertIn(f"exactBreakdowns.{key}", app)

    def test_employee_invites_restrict_cors_and_redirect_origins(self):
        edge = INVITE_FUNCTION.read_text(encoding="utf-8")
        self.assertIn("isRequestOriginAllowed", edge)
        self.assertIn("allowedRedirectOrigins", edge)
        self.assertIn("Invitation redirect origin is not allowed", edge)
        self.assertNotIn('"Access-Control-Allow-Origin": "*"', edge)

    def test_demo_activity_uses_relative_past_timestamps(self):
        demo = (WEB_ROOT / "demo-data.js").read_text(encoding="utf-8")
        self.assertIn("minutesAgo", demo)
        self.assertNotRegex(demo, re.compile(r'created_at:\s*"20\d\d-'))


if __name__ == "__main__":
    unittest.main()
