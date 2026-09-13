import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Implicit flow lets the emailed sign-in link work even when the phone
    // opens it in a different browser from the one that requested it.
    flowType: "implicit",
    detectSessionInUrl: true,
    persistSession: true,
  },
});

const CONSTRAINT_MESSAGES = {
  payments_unique_reference: "A payment with this transaction ID has already been recorded.",
  vehicles_plate_key: "A car with this plate number already exists.",
  agreements_one_active_per_driver: "This driver already has an active agreement.",
  agreements_one_active_per_vehicle: "This car is already with another driver.",
  service_types_name_key: "A service type with this name already exists.",
  payments_one_deposit_per_agreement: "This agreement already has a deposit.",
};

export function errorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  const message = error.message || "";
  if (message === "Failed to fetch" || /network|load failed/i.test(message)) {
    return "No connection. Check your internet and try again.";
  }
  if (error.code === "23505") {
    const match = Object.keys(CONSTRAINT_MESSAGES).find((name) => message.includes(name));
    if (match) return CONSTRAINT_MESSAGES[match];
  }
  return message || "Something went wrong. Please try again.";
}
