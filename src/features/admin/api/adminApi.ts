import { preprintApi } from './preprintApi';

export type {
  AdminDecisionStatus,
  AdminOverview,
  AdminPagination,
  AdminPublication,
  AdminPublicationAudience,
  AdminPublicationStatus,
  AdminReview,
  AdminTimelineEvent,
  AdminUser,
  AdminUsersResponse,
  AdminVersion,
  ResearcherProfile,
} from './preprintApi';

export const adminApi = preprintApi;
export default adminApi;
