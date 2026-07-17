import { strictObject } from "@/lib/validation";
import { idSchema, nameSchema } from "@/lib/schemas/master-data";

/**
 * Company CRUD input schemas (group companies: Macktiles, Multilac, …).
 * Company quota defaults are managed separately via the quota schemas so the
 * amount+period pair is always submitted as one unit.
 */

export const createCompanySchema = strictObject({ name: nameSchema });

export const updateCompanySchema = strictObject({ id: idSchema, name: nameSchema });

export const deleteCompanySchema = strictObject({ id: idSchema });
