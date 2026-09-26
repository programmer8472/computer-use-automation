import type { Member, MemberInput, NewMemberInput } from "./member.js";

export type SaveResult =
  { ok: true; member: Member } | { ok: false; reason: "duplicate_email" };

const seedMembers: readonly Member[] = [
  {
    memberId: "M-1001",
    firstName: "Avery",
    lastName: "Jordan",
    email: "avery.jordan@example.test",
    phone: "555-0101",
    address: "101 Maple Street, Northbank, NY 10001",
    ssnOnFile: false,
  },
  {
    memberId: "M-1002",
    firstName: "Morgan",
    lastName: "Lee",
    email: "morgan.lee@example.test",
    phone: "555-0102",
    address: "202 Cedar Avenue, Northbank, NY 10002",
    ssnOnFile: true,
  },
  {
    memberId: "M-1003",
    firstName: "Riley",
    lastName: "Patel",
    email: "riley.patel@example.test",
    phone: "555-0103",
    address: "303 Birch Road, Northbank, NY 10003",
    ssnOnFile: false,
  },
];

export class MemberRepository {
  readonly #members = new Map<string, Member>();
  #nextMemberNumber = 1004;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.#members.clear();
    this.#nextMemberNumber = 1004;
    for (const member of seedMembers) {
      this.#members.set(member.memberId, structuredClone(member));
    }
  }

  list(query = ""): Member[] {
    const normalizedQuery = query.trim().toLowerCase();
    const members = [...this.#members.values()].sort((left, right) =>
      left.memberId.localeCompare(right.memberId),
    );

    if (normalizedQuery.length === 0) {
      return members.map((member) => structuredClone(member));
    }

    return members
      .filter((member) =>
        [
          member.memberId,
          member.firstName,
          member.lastName,
          `${member.firstName} ${member.lastName}`,
          member.email,
          member.phone,
        ].some((value) => value.toLowerCase().includes(normalizedQuery)),
      )
      .map((member) => structuredClone(member));
  }

  get(memberId: string): Member | undefined {
    const member = this.#members.get(memberId.toUpperCase());
    return member === undefined ? undefined : structuredClone(member);
  }

  create(input: NewMemberInput): SaveResult {
    if (this.#hasDuplicateEmail(input.email)) {
      return { ok: false, reason: "duplicate_email" };
    }

    const member: Member = {
      ...structuredClone(input),
      memberId: this.#generateMemberId(),
      ssnOnFile: false,
    };
    this.#members.set(member.memberId, member);
    return { ok: true, member: structuredClone(member) };
  }

  update(memberId: string, input: MemberInput): SaveResult | undefined {
    const normalizedId = memberId.toUpperCase();
    if (!this.#members.has(normalizedId)) {
      return undefined;
    }
    if (this.#hasDuplicateEmail(input.email, normalizedId)) {
      return { ok: false, reason: "duplicate_email" };
    }

    const currentMember = this.#members.get(normalizedId);
    if (currentMember === undefined) {
      return undefined;
    }
    const member: Member = {
      ...structuredClone(input),
      memberId: normalizedId,
      ssnOnFile: currentMember.ssnOnFile,
    };
    this.#members.set(normalizedId, member);
    return { ok: true, member: structuredClone(member) };
  }

  delete(memberId: string): boolean {
    return this.#members.delete(memberId.toUpperCase());
  }

  markSsnOnFile(memberId: string): boolean {
    const normalizedId = memberId.toUpperCase();
    const member = this.#members.get(normalizedId);
    if (member === undefined) {
      return false;
    }
    this.#members.set(normalizedId, { ...member, ssnOnFile: true });
    return true;
  }

  #hasDuplicateEmail(email: string, excludingMemberId?: string): boolean {
    const normalizedEmail = email.toLowerCase();
    return [...this.#members.values()].some(
      (member) =>
        member.memberId !== excludingMemberId &&
        member.email.toLowerCase() === normalizedEmail,
    );
  }

  #generateMemberId(): string {
    let memberId: string;
    do {
      memberId = `M-${String(this.#nextMemberNumber).padStart(4, "0")}`;
      this.#nextMemberNumber += 1;
    } while (this.#members.has(memberId));
    return memberId;
  }
}
