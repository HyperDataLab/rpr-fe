/**
 * Centralized routes for the Public FE.
 */
export const ROUTES = {
  HOME: '/',
  FORBIDDEN: '/forbidden',
  REGISTER: '/#register-section',
  AUTH: {
    LOGIN: '/login',
  },
  ADMIN: {
    ROOT: '/admin',
    DASHBOARD: '/admin/submissions',
    SUBMISSIONS: '/admin/submissions',
    SUBMISSION_DETAIL: (id: string | number) => `/admin/submissions/${id}`,
    REVIEWS: '/admin/reviews',
    USERS: '/admin/users',
    SSO: '/admin/sso',
    REGISTRATIONS: '/admin/registrations',
    PROFILE: '/admin/profile',
  },
  LECTURER: {
    ROOT: '/lecturer',
    REVIEWS: '/lecturer/reviews',
    REVIEW_DETAIL: (id: string | number) => `/lecturer/reviews/${id}`,
    SUBMISSIONS: '/lecturer/submissions',
    SUBMISSION_DETAIL: (id: string | number) => `/lecturer/submissions/${id}`,
    SUBMISSION_EDIT: (id: string | number) => `/lecturer/submissions/${id}/edit`,
    NEW_SUBMISSION: '/lecturer/submissions/new',
    PUBLICATIONS: '/lecturer/publications',
    PUBLICATION_DETAIL: (id: string | number) => `/lecturer/publications/${id}`,
    PROFILE: '/lecturer/profile',
  },
  STUDENT: {
    ROOT: '/student',
    PREPRINTS: '/student/my-preprints',
    PUBLISHED: '/student/published',
    NEW_PREPRINT: '/student/my-preprints/new',
    PREPRINT_DETAIL: (id: string | number) => `/student/my-preprints/${id}`,
  },
} as const;

export default ROUTES;
