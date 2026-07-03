import { beforeEach, describe, expect, it, vi } from "vitest";

// The action's collaborators are mocked so the test exercises its logic — token
// forwarding, validation, revalidation, error passthrough — with no server.
const { postJson, getSessionToken, revalidatePath } = vi.hoisted(() => ({
  postJson: vi.fn(),
  getSessionToken: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ postJson }));
vi.mock("@/lib/session", () => ({ getSessionToken }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { acknowledgeCase, resolveCase } from "./case-actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  postJson.mockReset().mockResolvedValue({ ok: true });
  getSessionToken.mockReset().mockResolvedValue("supersecret");
  revalidatePath.mockReset();
});

describe("case mutations", () => {
  it("refuses to resolve without a reason, before touching the API", async () => {
    const result = await resolveCase({}, form({ id: "e1", reason: "   " }));
    expect(result.error).toBeTruthy();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("forwards the session token and reason, then revalidates both views", async () => {
    const result = await resolveCase({}, form({ id: "e1", reason: "Booked the fee, JE-441" }));
    expect(postJson).toHaveBeenCalledWith(
      "/exceptions/e1/resolve",
      { reason: "Booked the fee, JE-441" },
      "supersecret",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/exceptions/e1");
    expect(revalidatePath).toHaveBeenCalledWith("/exceptions");
    expect(result.ok).toBe(true);
  });

  it("acknowledges with an optional note, omitted when blank", async () => {
    await acknowledgeCase({}, form({ id: "e1", note: "" }));
    expect(postJson).toHaveBeenCalledWith("/exceptions/e1/acknowledge", { note: undefined }, "supersecret");
  });

  it("reports a lapsed session instead of posting anonymously", async () => {
    getSessionToken.mockResolvedValue(undefined);
    const result = await acknowledgeCase({}, form({ id: "e1" }));
    expect(result.error).toBeTruthy();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("surfaces the API's own error and does not revalidate on failure", async () => {
    postJson.mockResolvedValue({ ok: false, status: 409, error: "illegal transition" });
    const result = await resolveCase({}, form({ id: "e1", reason: "twice" }));
    expect(result.error).toBe("illegal transition");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
