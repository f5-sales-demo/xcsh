export interface SfUserProfile {
	userId: string;
	username: string;
	firstName: string;
	lastName: string;
	email: string;
	title?: string;
	department?: string;
	division?: string;
	role?: string;
	profile?: string;
	aboutMe?: string;
	companyName?: string;
	managerId?: string;
	managerName?: string;
	managerEmail?: string;
	phone?: string;
	street?: string;
	city?: string;
	state?: string;
	postalCode?: string;
	country?: string;
	fetchedAt: string;
}

export interface SfOrg {
	alias?: string;
	username: string;
	orgId: string;
	instanceUrl: string;
	connectedStatus: string;
	isDefault: boolean;
	isSandbox: boolean;
}

export interface SfQueryResult<T = Record<string, unknown>> {
	totalSize: number;
	done: boolean;
	records: T[];
}

export interface SfOrgListResult {
	nonScratchOrgs: SfOrg[];
	sandboxes: SfOrg[];
	scratchOrgs: SfOrg[];
	devHubs: SfOrg[];
	other: SfOrg[];
}

export interface SfJsonResult {
	status: number;
	result: unknown;
	message?: string;
	warnings?: string[];
}

export interface SfRawResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export const SF_ORG_SAFE_FIELDS = ["username", "orgId", "instanceUrl", "connectedStatus", "alias"] as const;

export const XCSH_USER_KEY_PREFIX = "xcsh.user.";

export const XCSH_USER_KEYS: Record<keyof SfUserProfile, string> = {
	userId: "xcsh.user.id",
	username: "xcsh.user.username",
	firstName: "xcsh.user.firstName",
	lastName: "xcsh.user.lastName",
	email: "xcsh.user.email",
	title: "xcsh.user.title",
	department: "xcsh.user.department",
	division: "xcsh.user.division",
	role: "xcsh.user.role",
	profile: "xcsh.user.profile",
	aboutMe: "xcsh.user.aboutMe",
	companyName: "xcsh.user.companyName",
	managerId: "xcsh.user.managerId",
	managerName: "xcsh.user.managerName",
	managerEmail: "xcsh.user.managerEmail",
	phone: "xcsh.user.phone",
	street: "xcsh.user.street",
	city: "xcsh.user.city",
	state: "xcsh.user.state",
	postalCode: "xcsh.user.postalCode",
	country: "xcsh.user.country",
	fetchedAt: "xcsh.user.fetchedAt",
};

export const USER_PROFILE_SOQL = `SELECT Id, Username, FirstName, LastName, Email, Title, Department, Division, CompanyName, AboutMe, ManagerId, Manager.Name, Manager.Email, UserRole.Name, Profile.Name, Street, City, State, PostalCode, Country, Phone, MobilePhone FROM User WHERE Username = '{username}'`;

export const ORG_ALIAS_PATTERN = /^[a-zA-Z0-9._@-]+$/;
