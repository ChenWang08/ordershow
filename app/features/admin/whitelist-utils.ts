import type { AdminCustomer } from "../../api";
import type { WhitelistRow } from "../../domain/import-domain";

export function mapAdminWhitelistRows(customers: AdminCustomer[], regions: ReadonlyMap<string, string> = new Map()): WhitelistRow[] {
  return customers.map((customer, index) => ({
    id: String(customer.id), serverVersion: customer.lockVersion, sequence: customer.excelSequence ?? index + 1,
    customerType: customer.customerType === "GENERAL" ? "综合客户" : customer.customerType === "SPECIAL" ? "特渠专业客户" : "",
    region: regions.get(customer.regionCode || "") || customer.regionCode || "", branch: customer.branchName || "",
    dealerShort: customer.dealerShortName || "", dealerFull: customer.dealerFullName, dealerType: customer.dealerCategory || "",
    dealerName: customer.contactName || "", dealerPhone: customer.phone || customer.phoneMasked, confirmerName: customer.confirmerName || "",
    confirmerPhone: customer.confirmerPhone || customer.confirmerPhoneMasked || "", status: customer.active ? "有效" : "待处理", source: "excel",
  }));
}
