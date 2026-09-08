"use client";

import { useCallback, useState } from "react";
import type { AttendanceRow, ProductImportRow, WhitelistRow } from "../../domain/import-domain";

// These three workspaces remain mounted across surface switches in the combined preview.
export function useImportWorkspaceState() {
  const [productRows, setProductRows] = useState<ProductImportRow[]>([]);
  const [productImportCompleted, setProductImportCompleted] = useState(false);
  const [productImportHasRun, setProductImportHasRun] = useState(false);
  const [whitelistRows, setWhitelistRows] = useState<WhitelistRow[]>([]);
  const [whitelistImportCompleted, setWhitelistImportCompleted] = useState(false);
  const [whitelistImportHasRun, setWhitelistImportHasRun] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [attendanceFileName, setAttendanceFileName] = useState("");
  const [attendanceWarnings, setAttendanceWarnings] = useState<string[]>([]);
  const [attendanceSheetCounts, setAttendanceSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [attendanceImportError, setAttendanceImportError] = useState("");
  const markProductImportCommitted = useCallback(() => setProductImportHasRun(true), []);
  const markWhitelistImportCommitted = useCallback(() => setWhitelistImportHasRun(true), []);
  return {
    products: { rows: productRows, setRows: setProductRows, completed: productImportCompleted,
      setCompleted: setProductImportCompleted, hasRun: productImportHasRun, markCommitted: markProductImportCommitted },
    whitelist: { rows: whitelistRows, setRows: setWhitelistRows, completed: whitelistImportCompleted,
      setCompleted: setWhitelistImportCompleted, hasRun: whitelistImportHasRun, markCommitted: markWhitelistImportCommitted },
    attendance: { rows: attendanceRows, setRows: setAttendanceRows, fileName: attendanceFileName,
      setFileName: setAttendanceFileName, warnings: attendanceWarnings, setWarnings: setAttendanceWarnings,
      sheetCounts: attendanceSheetCounts, setSheetCounts: setAttendanceSheetCounts,
      error: attendanceImportError, setError: setAttendanceImportError },
  };
}
