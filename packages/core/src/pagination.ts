import { warning } from "./normalize.js";
import type { PaginationInfo, Warning } from "./types.js";

export interface CursorPage {
  has_more?: boolean;
  next_page?: string | null;
}

export interface PaginationResult<TPage> {
  pages: TPage[];
  info: PaginationInfo;
  warnings: Warning[];
}

export async function paginateCursor<TPage extends CursorPage>(
  fetchPage: (page: string | null) => Promise<TPage>,
  maxPages: number,
): Promise<PaginationResult<TPage>> {
  const pages: TPage[] = [];
  let page: string | null = null;
  let truncated = false;

  for (let index = 0; index < maxPages; index += 1) {
    const result = await fetchPage(page);
    pages.push(result);

    if (result.has_more !== true || result.next_page === null || result.next_page === undefined) {
      page = null;
      break;
    }

    page = result.next_page;
  }

  if (page !== null) {
    truncated = true;
  }

  return {
    pages,
    info: {
      pages_fetched: pages.length,
      provider_request_count: pages.length,
      truncated,
      next_page: page,
    },
    warnings: truncated
      ? [warning("pagination_truncated", `Reached max_pages=${maxPages}; results are partial`, { next_page: page })]
      : [],
  };
}

