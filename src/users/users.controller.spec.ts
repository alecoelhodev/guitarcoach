import { UsersController } from './users.controller';

// @thallesp/nestjs-better-auth's @Roles() decorator writes this key via
// SetMetadata, and its global AuthGuard reads the same key at request time.
// The library doesn't export a constant for it, so it's inlined here.
const ROLES_METADATA_KEY = 'ROLES';

function rolesRequiredFor(
  methodName: keyof UsersController,
): string[] | undefined {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- reflecting on the method reference, not calling it
  const handler = UsersController.prototype[methodName];
  return Reflect.getMetadata(ROLES_METADATA_KEY, handler) as
    string[] | undefined;
}

describe('UsersController RBAC metadata', () => {
  it.each(['findAll', 'findOne', 'update', 'remove'] as const)(
    'restricts %s to the admin role',
    (methodName) => {
      expect(rolesRequiredFor(methodName)).toEqual(['admin']);
    },
  );

  it('leaves "me" open to any authenticated user', () => {
    expect(rolesRequiredFor('me')).toBeUndefined();
  });
});
