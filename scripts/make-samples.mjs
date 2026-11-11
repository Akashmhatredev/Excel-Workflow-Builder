#!/usr/bin/env node
/**
 * Generate the sample files in public/samples (run with `npm run samples`).
 *
 *   sample-data.xlsx          ~300 sales orders ("Orders") plus a smaller "Returns" sheet
 *   sample-data-renamed.xlsx  similar orders with renamed / re-cased headers (tests "Fix mapping")
 *   sample-template.json      a template export that shows off the engine against sample-data.xlsx
 *
 * Everything is seeded, so the data is the same on every run.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTable, readWorkbook, writeXlsxBook } from "../lib/excel.js";
import {
  APP_ID,
  SCHEMA_VERSION,
  createAggregation,
  createDefinition,
  createField,
  createFilterGroup,
  createFilterRule,
  createGroupBy,
  createOutput,
  createSortRule,
  createTemplate,
  createTransform,
} from "../lib/schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../public/samples");
const STAMP = "2026-11-10T09:00:00.000Z";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ["Asha", "Rahul", "Priya", "Vikram", "Neha", "Arjun", "Sneha", "Karan", "Meera", "Rohan", "Ananya", "Dev", "Isha", "Kabir", "Pooja", "Sameer", "Tanvi", "Yash"];
const LAST_NAMES = ["Sharma", "Patil", "Iyer", "Khan", "Das", "Mehta", "Rao", "Joshi", "Kulkarni", "Singh", "Nair", "Gupta", "Desai", "Bose"];
const CITIES = {
  North: ["Delhi", "Jaipur", "Lucknow", "Chandigarh"],
  South: ["Bengaluru", "Chennai", "Hyderabad", "Kochi"],
  East: ["Kolkata", "Bhubaneswar", "Patna", "Guwahati"],
  West: ["Mumbai", "Pune", "Ahmedabad", "Surat"],
};
const PRODUCTS = [
  ["Notebook A5", "Stationery", 120],
  ["Gel Pen Set", "Stationery", 240],
  ["Desk Lamp", "Furniture", 1450],
  ["Office Chair", "Furniture", 6800],
  ["Wireless Mouse", "Electronics", 899],
  ["Mechanical Keyboard", "Electronics", 4299],
  ["27in Monitor", "Electronics", 15999],
  ["Laptop Backpack", "Accessories", 1899],
  ["Steel Bottle", "Accessories", 549],
  ["Noise-cancelling Headphones", "Electronics", 7499],
];
const STATUSES = ["Delivered", "Delivered", "Delivered", "Shipped", "Shipped", "Pending", "Cancelled"];
const REPS = ["Nikhil Jain", "Farah Ali", "Suresh Pillai", "Ritika Sen", "Omkar Shinde"];
const NOTES = ["Gift wrap", "Call before delivery", "Bulk order", "Deliver after 6 pm", "Repeat customer"];
const RETURN_REASONS = ["Damaged in transit", "Wrong item", "Changed mind", "Defective", "Late delivery"];

/** Mess a string up the way real exports are messy. */
function messy(random, text, { blank = 0, spaces = 0.08, casing = 0.08 } = {}) {
  const roll = random();
  if (roll < blank) return null;
  let out = text;
  if (random() < spaces) out = random() < 0.5 ? `  ${out} ` : out.replace(" ", "   ") + " ";
  if (random() < casing) out = random() < 0.5 ? out.toLowerCase() : out.toUpperCase();
  return out;
}

function makeOrders(seed, count, firstId) {
  const random = mulberry32(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const start = Date.UTC(2024, 0, 1);
  const orders = [];
  for (let i = 0; i < count; i += 1) {
    const region = pick(Object.keys(CITIES));
    const [product, category, price] = pick(PRODUCTS);
    const discount = random() < 0.08 ? null : pick([0, 0, 0, 5, 10, 15]);
    const priceVariation = Math.round(price * (0.95 + random() * 0.1) * 100) / 100;
    orders.push([
      `SO-${firstId + i}`,
      new Date(start + Math.floor(random() * 366) * 86400000),
      messy(random, pick(FIRST_NAMES)),
      messy(random, pick(LAST_NAMES), { blank: 0.02 }),
      messy(random, region, { casing: 0.15, spaces: 0.1 }),
      messy(random, pick(CITIES[region]), { casing: 0.05 }),
      product,
      category,
      1 + Math.floor(random() * (price > 5000 ? 3 : 12)),
      priceVariation,
      discount,
      messy(random, pick(STATUSES), { casing: 0.2, spaces: 0.1 }),
      messy(random, pick(REPS), { blank: 0.06, casing: 0.05 }),
      random() < 0.18 ? pick(NOTES) : null,
    ]);
  }
  orders.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  return orders;
}

function makeReturns(seed, orders, count) {
  const random = mulberry32(seed);
  const delivered = orders.filter((order) => /deliver/i.test(order[11] || ""));
  const returns = [];
  for (let i = 0; i < count && delivered.length; i += 1) {
    const order = delivered.splice(Math.floor(random() * delivered.length), 1)[0];
    const qty = order[8];
    const refund = Math.round(order[9] * Math.max(1, Math.floor(qty / 2)) * 100) / 100;
    returns.push([
      `RT-${5001 + i}`,
      order[0],
      new Date(order[1].getTime() + (3 + Math.floor(random() * 20)) * 86400000),
      RETURN_REASONS[Math.floor(random() * RETURN_REASONS.length)],
      refund,
    ]);
  }
  returns.sort((a, b) => a[2] - b[2]);
  return returns;
}

const DATE_CELL = { type: "dateFormat", pattern: "DD/MM/YYYY" };
const MONEY_CELL = { type: "numberFormat", decimals: 2, thousands: true, prefix: "", suffix: "" };

const ORDER_HEADERS = [
  "Order ID",
  "Order Date",
  "Customer First Name",
  "Customer Last Name",
  "Region",
  "City",
  "Product",
  "Category",
  "Qty",
  "Unit Price",
  "Discount %",
  "Status",
  "Sales Rep",
  "Notes",
];
const RENAMED_HEADERS = [
  "order id",
  "Order date",
  "Cust First Name",
  "Cust Last Name",
  "REGION",
  "City",
  "Product Name",
  "Category",
  "Quantity",
  "Unit price",
  "Discount %",
  "Status",
  "Sales Rep",
  "Notes",
];

const columnsFor = (headers) =>
  headers.map((name, index) => ({ name, format: index === 1 ? DATE_CELL : index === 9 ? MONEY_CELL : null }));

/* ---------------- workbooks ---------------- */

const orders = makeOrders(20240105, 300, 10001);
const returns = makeReturns(77, orders, 24);
const sampleBytes = writeXlsxBook([
  { sheetName: "Orders", result: { columns: columnsFor(ORDER_HEADERS), rows: orders } },
  {
    sheetName: "Returns",
    result: {
      columns: [
        { name: "Return ID", format: null },
        { name: "Order ID", format: null },
        { name: "Return Date", format: DATE_CELL },
        { name: "Reason", format: null },
        { name: "Refund Amount", format: MONEY_CELL },
      ],
      rows: returns,
    },
  },
]);

const renamedBytes = writeXlsxBook([
  { sheetName: "Orders", result: { columns: columnsFor(RENAMED_HEADERS), rows: makeOrders(424242, 120, 20001) } },
]);

/* ---------------- template ---------------- */

const table = buildTable(readWorkbook(sampleBytes, "sample-data.xlsx"), { sheetNames: ["Orders"] });
const tr = (type, id, params = {}) => createTransform(type, { id, ...params });

const orderId = createField({
  id: "fld_order_id",
  name: "Order ID",
  source: { kind: "column", column: "Order ID" },
  transforms: [tr("trim", "tr_order_id_trim"), tr("upper", "tr_order_id_upper")],
});
const orderDate = createField({
  id: "fld_order_date",
  name: "Order Date",
  source: { kind: "column", column: "Order Date" },
  transforms: [tr("dateFormat", "tr_order_date_format", { pattern: "DD MMM YYYY" })],
});
const customer = createField({
  id: "fld_customer",
  name: "Customer",
  source: { kind: "combine", template: "{Customer First Name} {Customer Last Name}" },
  transforms: [tr("trim", "tr_customer_trim"), tr("title", "tr_customer_title")],
});
const region = createField({
  id: "fld_region",
  name: "Region",
  source: { kind: "column", column: "Region" },
  transforms: [tr("trim", "tr_region_trim"), tr("title", "tr_region_title")],
});
const product = createField({
  id: "fld_product",
  name: "Product",
  source: { kind: "column", column: "Product" },
  transforms: [tr("trim", "tr_product_trim")],
});
const qty = createField({ id: "fld_qty", name: "Qty", source: { kind: "column", column: "Qty" } });
const lineTotal = createField({
  id: "fld_line_total",
  name: "Line Total",
  source: { kind: "formula", expression: "ROUND({Qty} * {Unit Price} * (1 - {Discount %} / 100), 2)" },
  transforms: [tr("numberFormat", "tr_line_total_format", { decimals: 2, thousands: true, prefix: "₹", suffix: "" })],
});
const status = createField({
  id: "fld_status",
  name: "Status",
  source: { kind: "column", column: "Status" },
  transforms: [tr("trim", "tr_status_trim"), tr("upper", "tr_status_upper")],
});
const salesRep = createField({
  id: "fld_sales_rep",
  name: "Sales Rep",
  source: { kind: "column", column: "Sales Rep" },
  transforms: [tr("trim", "tr_sales_rep_trim"), tr("title", "tr_sales_rep_title"), tr("default", "tr_sales_rep_default", { value: "Unassigned" })],
});

const totalSales = createAggregation({ id: "agg_total_sales", fieldId: lineTotal.id, fn: "sum", name: "Total Sales" });
const orderCount = createAggregation({ id: "agg_orders", fieldId: "", fn: "count", name: "Orders" });

const definition = createDefinition({
  source: {
    sheetNames: ["Orders"],
    headerRow: 1,
    expectedColumns: table.columns.map(({ name, type }) => ({ name, type })),
  },
  fields: [orderId, orderDate, customer, region, product, qty, lineTotal, status, salesRep],
  filters: createFilterGroup({
    combinator: "and",
    rules: [
      createFilterRule({
        id: "flt_not_cancelled",
        target: { kind: "field", ref: status.id },
        operator: "notEquals",
        value: "CANCELLED",
      }),
    ],
  }),
  sort: [createSortRule({ id: "srt_order_date", key: orderDate.id, direction: "asc" })],
  // The Summary tab opens on "Sum of Line Total by Region and Status".
  summary: { rowKey: region.id, columnKey: status.id, valueKey: lineTotal.id, fn: "sum" },
  outputs: [
    createOutput({ id: "out_order_details", name: "Order details", fileType: "xlsx", sheetName: "Orders" }),
    createOutput({
      id: "out_sales_by_region",
      name: "Sales by region",
      fileType: "xlsx",
      sheetName: "By region",
      overrides: {
        groupBy: {
          enabled: true,
          config: createGroupBy({ enabled: true, keys: [region.id], aggregations: [totalSales, orderCount] }),
        },
        sort: {
          enabled: true,
          rules: [createSortRule({ id: "srt_total_sales", key: totalSales.id, direction: "desc" })],
        },
      },
      report: {
        enabled: true,
        title: "Sales by region",
        subtitle: "Every order except cancelled ones, 2024",
        theme: "brand",
        brandColor: "#059669",
        showDate: true,
        footer: "Source: sample-data.xlsx",
      },
    }),
  ],
});

const template = {
  ...createTemplate({
    name: "Sales orders: clean-up and regional summary",
    description:
      "Cleans the raw sales-order dump (names, regions, statuses, dates), adds a line total and builds a sales-by-region summary.",
    tags: ["Sales", "Sample"],
    definition,
  }),
  id: "tpl_sample_sales_orders",
  createdAt: STAMP,
  updatedAt: STAMP,
};

const exported = { app: APP_ID, kind: "template", schemaVersion: SCHEMA_VERSION, exportedAt: STAMP, template };

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "sample-data.xlsx"), sampleBytes);
await writeFile(path.join(outDir, "sample-data-renamed.xlsx"), renamedBytes);
await writeFile(path.join(outDir, "sample-template.json"), `${JSON.stringify(exported, null, 2)}\n`);
console.log(
  `Wrote ${orders.length} orders + ${returns.length} returns, a renamed copy and a template to ${path.relative(process.cwd(), outDir) || outDir}`,
);
