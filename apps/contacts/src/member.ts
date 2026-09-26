export interface Member {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  ssnOnFile: boolean;
}

export type MemberInput = Omit<Member, "ssnOnFile">;

export type NewMemberInput = Omit<MemberInput, "memberId">;

export type MemberField = keyof MemberInput;

export type ValidationErrors = Partial<Record<MemberField, string>>;

const memberIdPattern = /^M-[0-9]{4}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9()+.\-\s]{7,20}$/;

export function normalizeMemberInput(input: MemberInput): MemberInput {
  return {
    memberId: input.memberId.trim().toUpperCase(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    address: input.address.trim(),
  };
}

export function normalizeNewMemberInput(input: NewMemberInput): NewMemberInput {
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    address: input.address.trim(),
  };
}

export function validateMemberInput(input: MemberInput): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!memberIdPattern.test(input.memberId)) {
    errors.memberId = "Use the synthetic member ID format M-0000.";
  }
  if (input.firstName.length === 0) {
    errors.firstName = "First name is required.";
  }
  if (input.lastName.length === 0) {
    errors.lastName = "Last name is required.";
  }
  if (!emailPattern.test(input.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!phonePattern.test(input.phone)) {
    errors.phone = "Enter a valid synthetic phone number.";
  }
  if (input.address.length === 0) {
    errors.address = "Address is required.";
  }

  return errors;
}

export function validateNewMemberInput(
  input: NewMemberInput,
): ValidationErrors {
  const errors = validateMemberInput({ ...input, memberId: "M-0000" });
  delete errors.memberId;
  return errors;
}

export function readNewMemberForm(body: unknown): NewMemberInput {
  const form = isRecord(body) ? body : {};

  return normalizeNewMemberInput({
    firstName: readString(form.firstName),
    lastName: readString(form.lastName),
    email: readString(form.email),
    phone: readString(form.phone),
    address: readString(form.address),
  });
}

export function readMemberForm(
  body: unknown,
  memberIdOverride?: string,
): MemberInput {
  const form = isRecord(body) ? body : {};

  return normalizeMemberInput({
    memberId: memberIdOverride ?? readString(form.memberId),
    firstName: readString(form.firstName),
    lastName: readString(form.lastName),
    email: readString(form.email),
    phone: readString(form.phone),
    address: readString(form.address),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
