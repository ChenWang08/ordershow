import type { AdminAttendee, AttendanceMatchPreview } from "../../api";
import type { AttendanceRow } from "../../domain/import-domain";

export function cloneAttendanceRows(rows: AttendanceRow[]) {
  return rows.map((row) => ({ ...row }));
}

export function mapAdminAttendanceRows(attendees: AdminAttendee[], offset = 0): AttendanceRow[] {
  return attendees.map((attendee, index) => ({
    id: String(attendee.id), activityCustomerId: attendee.activityCustomerId ?? null, sequence: offset + index + 1,
    dealerName: attendee.participantName || "", gender: attendee.gender || "", contactPhone: attendee.phone || attendee.phoneMasked || "",
    branch: attendee.branchName || "", dealerCompany: attendee.dealerName, participantType: attendee.participantType || "",
    customerType: attendee.participantType?.includes("特渠") ? "特渠专业客户" : attendee.participantType?.includes("综合") ? "综合客户" : "",
    matchStatus: attendee.matchStatus, matchMethod: attendee.matchMethod, matchReasonCode: attendee.matchReasonCode,
    matchedDealerName: attendee.matchedDealerName, lotteryEligible: attendee.lotteryEligible,
  }));
}

export function mergeAttendanceMatchPreview(rows: AttendanceRow[], preview: AttendanceMatchPreview) {
  const byStagingRow = new Map(preview.rows.map((row) => [row.stagingRowId, row]));
  return rows.map((row) => {
    const match = row.serverRowId ? byStagingRow.get(row.serverRowId) : undefined;
    return match ? { ...row, activityCustomerId: match.activityCustomerId ?? null, matchStatus: match.matchStatus,
      matchMethod: match.matchMethod, matchReasonCode: match.matchReasonCode,
      matchedDealerName: match.matchedDealerName, lotteryEligible: match.lotteryEligible } : row;
  });
}
