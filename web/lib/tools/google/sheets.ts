import { z } from "zod";
import { defineTool, fail, ok, type JarvisTool, type ToolResult } from "@/lib/tools/types";
import { guard, sheetsClient, short } from "./util";

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Cell = z.infer<typeof cell>;
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
const norm = (rows: Cell[][]): (string | number | boolean)[][] => rows.map((r) => r.map((c) => (c === null ? "" : c)));

const sheetsCreate = defineTool({
  name: "sheets_create",
  description: "Create a Google Sheet with a header row and optional data rows. Use to log, tabulate or export information (expenses, leads, tracker). Header row is bolded and frozen.",
  risk: "write",
  connector: "drive",
  inputSchema: z.object({
    title: z.string().min(1).describe("Spreadsheet title."),
    headers: z.array(z.string()).min(1).max(50).describe("Column headers."),
    rows: z.array(z.array(cell)).max(1000).optional().describe("Data rows; each row is an array of cell values."),
  }),
  title: (i) => `Creating sheet “${short(i.title, 40)}”`,
  execute: (input, ctx) =>
    guard("drive", async () => {
      const sheets = await sheetsClient(ctx);
      const created = await sheets.spreadsheets.create({ requestBody: { properties: { title: input.title } }, fields: "spreadsheetId,sheets.properties(sheetId,title)" });
      const id = created.data.spreadsheetId;
      const first = created.data.sheets?.[0]?.properties;
      if (!id) return fail("Google Sheets did not return a spreadsheet id.", "upstream_error", "Retry once.");
      const sheetName = first?.title ?? "Sheet1";
      const values = [input.headers, ...norm(input.rows ?? [])];
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${quoteSheet(sheetName)}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
      try {
        if (first?.sheetId !== undefined && first.sheetId !== null) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: id,
            requestBody: {
              requests: [
                { repeatCell: { range: { sheetId: first.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
                { updateSheetProperties: { properties: { sheetId: first.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
                { autoResizeDimensions: { dimensions: { sheetId: first.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: Math.min(input.headers.length, 26) } } },
              ],
            },
          });
        }
      } catch {
        /* cosmetic formatting only */
      }
      const back = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: quoteSheet(sheetName) });
      const got = back.data.values ?? [];
      const verified = got.length === values.length && (got[0]?.[0] ?? "") === input.headers[0];
      return {
        ok: verified,
        summary: `Sheet “${input.title}” created with ${input.rows?.length ?? 0} row${(input.rows?.length ?? 0) === 1 ? "" : "s"}`,
        data: { spreadsheetId: id, url: sheetUrl(id), sheetName, rows: input.rows?.length ?? 0 },
        verified,
        evidence: `Re-read ${quoteSheet(sheetName)}: ${got.length} rows (expected ${values.length}, including header)`,
        error: verified ? undefined : "upstream_error",
        card: { type: "doc", title: input.title, url: sheetUrl(id), kind: "sheet" },
      } satisfies ToolResult;
    }),
});

const sheetsAppendRows = defineTool({
  name: "sheets_append_rows",
  description: "Append rows to the end of a Google Sheet (e.g. log an expense, add a lead). Values are parsed like typed input (numbers, dates, formulas).",
  risk: "write",
  connector: "drive",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet id."),
    rows: z.array(z.array(cell)).min(1).max(500).describe("Rows to append; each row is an array of cell values."),
    sheetName: z.string().optional().describe("Tab name; defaults to the first tab."),
  }),
  title: (i) => `Adding ${i.rows.length} row${i.rows.length === 1 ? "" : "s"} to a sheet`,
  execute: (input, ctx) =>
    guard("drive", async () => {
      const sheets = await sheetsClient(ctx);
      let tab = input.sheetName;
      if (!tab) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: input.spreadsheetId, fields: "sheets.properties.title" });
        tab = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
      }
      const r = await sheets.spreadsheets.values.append({
        spreadsheetId: input.spreadsheetId,
        range: `${quoteSheet(tab)}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: norm(input.rows) },
      });
      const updates = r.data.updates;
      const updatedRows = updates?.updatedRows ?? 0;
      let readBack = 0;
      if (updates?.updatedRange) {
        const back = await sheets.spreadsheets.values.get({ spreadsheetId: input.spreadsheetId, range: updates.updatedRange });
        readBack = back.data.values?.length ?? 0;
      }
      const verified = updatedRows === input.rows.length && readBack >= input.rows.length;
      return {
        ok: updatedRows > 0,
        summary: `Added ${updatedRows} row${updatedRows === 1 ? "" : "s"} to “${tab}”`,
        data: { spreadsheetId: input.spreadsheetId, url: sheetUrl(input.spreadsheetId), sheetName: tab, range: updates?.updatedRange, rowsAdded: updatedRows },
        verified,
        evidence: `Sheets reports ${updatedRows} rows written to ${updates?.updatedRange ?? "?"}; read-back returned ${readBack} rows`,
        error: updatedRows > 0 ? undefined : "upstream_error",
        card: { type: "doc", title: `${updatedRows} row${updatedRows === 1 ? "" : "s"} added to ${tab}`, url: sheetUrl(input.spreadsheetId), kind: "sheet" },
      } satisfies ToolResult;
    }),
});

const sheetsRead = defineTool({
  name: "sheets_read",
  description: "Read values from a Google Sheet (A1 range such as 'Sheet1!A1:D20'; default is the whole first tab). Returns up to 200 rows.",
  risk: "read",
  connector: "drive",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet id."),
    range: z.string().optional().describe("A1 notation range, e.g. 'Expenses!A1:F50'. Omit for the first tab."),
  }),
  title: () => "Reading a Google Sheet",
  execute: (input, ctx) =>
    guard("drive", async () => {
      const sheets = await sheetsClient(ctx);
      let range = input.range;
      let titleStr = "";
      if (!range) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: input.spreadsheetId, fields: "properties.title,sheets.properties.title" });
        titleStr = meta.data.properties?.title ?? "";
        range = quoteSheet(meta.data.sheets?.[0]?.properties?.title ?? "Sheet1");
      }
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: input.spreadsheetId, range });
      const all = r.data.values ?? [];
      const values = all.slice(0, 200);
      return ok(`Read ${values.length} row${values.length === 1 ? "" : "s"} from ${titleStr ? `“${titleStr}”` : r.data.range ?? range}${all.length > 200 ? ` (of ${all.length})` : ""}`, {
        data: { spreadsheetId: input.spreadsheetId, range: r.data.range ?? range, totalRows: all.length, truncated: all.length > 200, values, url: sheetUrl(input.spreadsheetId) },
      });
    }),
});

export const sheetsTools: JarvisTool[] = [sheetsCreate, sheetsAppendRows, sheetsRead];
