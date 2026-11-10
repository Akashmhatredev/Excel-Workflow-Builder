#!/usr/bin/env node
/**
 * Write a large, deterministic sales-order file for performance testing.
 *
 *   node scripts/make-large-sample.mjs <out.xlsx|out.csv> [rows=100000] [columns=20]
 *
 * The output is not committed (write it somewhere outside the repo, or delete it after use).
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { writeCsv, writeXlsx } from "../lib/excel.js";

const [target, rowsArg, colsArg] = process.argv.slice(2);
if (!target || !/\.(xlsx|csv)$/i.test(target)) {
  console.error("Usage: node scripts/make-large-sample.mjs <out.xlsx|out.csv> [rows=100000] [columns=20]");
  process.exit(1);
}
const rowCount = Math.max(1, Number(rowsArg) || 100000);
const columnCount = Math.max(14, Number(colsArg) || 20);

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

const random = mulberry32(20241105);
const pick = (list) => list[Math.floor(random() * list.length)];
const REGIONS = ["North", "South", "East", "West", "Central"];
const CITIES = ["Pune", "Mumbai", "Delhi", "Chennai", "Kolkata", "Bengaluru", "Hyderabad", "Jaipur", "Lucknow", "Surat"];
const PRODUCTS = ["Notebook", "Pen Set", "Desk Lamp", "Monitor", "Keyboard", "Mouse", "Chair", "Backpack", "Bottle", "Headphones"];
const CATEGORIES = ["Stationery", "Electronics", "Furniture", "Accessories"];
const STATUSES = ["Delivered", "Shipped", "Pending", "Cancelled", "Returned"];
const FIRST = ["Asha", "Rahul", "Priya", "Vikram", "Neha", "Arjun", "Sneha", "Karan", "Meera", "Rohan"];
const LAST = ["Sharma", "Patil", "Iyer", "Khan", "Das", "Mehta", "Rao", "Joshi", "Kulkarni", "Singh"];

const base = [
  ["Order ID", "text"],
  ["Order Date", "date"],
  ["Customer First Name", "text"],
  ["Customer Last Name", "text"],
  ["Region", "text"],
  ["City", "text"],
  ["Product", "text"],
  ["Category", "text"],
  ["Qty", "number"],
  ["Unit Price", "number"],
  ["Discount %", "number"],
  ["Status", "text"],
  ["Sales Rep", "text"],
  ["Notes", "text"],
];
const columns = base.map(([name]) => ({ name, format: null }));
columns[1].format = { type: "dateFormat", pattern: "DD/MM/YYYY" };
for (let c = base.length; c < columnCount; c += 1) columns.push({ name: `Metric ${c - base.length + 1}`, format: null });

const start = Date.UTC(2023, 0, 1);
const rows = new Array(rowCount);
for (let r = 0; r < rowCount; r += 1) {
  const row = [
    `SO-${String(100000 + r)}`,
    new Date(start + Math.floor(random() * 730) * 86400000),
    pick(FIRST),
    pick(LAST),
    pick(REGIONS),
    pick(CITIES),
    pick(PRODUCTS),
    pick(CATEGORIES),
    1 + Math.floor(random() * 20),
    Math.round((50 + random() * 4950) * 100) / 100,
    pick([0, 0, 5, 10, 15]),
    pick(STATUSES),
    `${pick(FIRST)} ${pick(LAST)}`,
    random() < 0.2 ? "Gift wrap" : null,
  ];
  for (let c = base.length; c < columnCount; c += 1) row.push(Math.round(random() * 100000) / 100);
  rows[r] = row;
}

const result = { columns, rows };
const started = performance.now();
const bytes = /\.csv$/i.test(target) ? writeCsv(result) : writeXlsx(result, { sheetName: "Orders" });
await writeFile(target, bytes);
console.log(
  `Wrote ${rowCount.toLocaleString("en-US")} rows x ${columns.length} columns to ${path.resolve(target)} ` +
    `(${(bytes.length / 1048576).toFixed(1)} MB) in ${Math.round(performance.now() - started)} ms`,
);
