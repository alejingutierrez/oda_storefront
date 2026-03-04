import { GET as getState } from "../state/route";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return getState(req);
}
