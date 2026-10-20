import type { UserEntity } from "../store/types.js";
import type { UserResponse } from "../schemas/auth.schemas.js";

/** Maps a stored user row to the public `UserResponse` shape. */
export function toUserResponse(user: UserEntity): UserResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    ...(user.organizationName ? { organizationName: user.organizationName } : {}),
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}
