import { TasksController } from './tasks.controller';

// @thallesp/nestjs-better-auth's @Roles() decorator writes this key via
// SetMetadata, and its global AuthGuard reads the same key at request time.
// The library doesn't export a constant for it, so it's inlined here.
const ROLES_METADATA_KEY = 'ROLES';

function rolesRequiredFor(
  methodName: keyof TasksController,
): string[] | undefined {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- reflecting on the method reference, not calling it
  const handler = TasksController.prototype[methodName];
  return Reflect.getMetadata(ROLES_METADATA_KEY, handler) as
    string[] | undefined;
}

describe('TasksController RBAC metadata', () => {
  it.each(['create', 'update', 'remove'] as const)(
    'restricts %s to the admin role',
    (methodName) => {
      expect(rolesRequiredFor(methodName)).toEqual(['admin']);
    },
  );

  it.each(['findAll', 'findOne'] as const)(
    'leaves %s open to any authenticated user',
    (methodName) => {
      expect(rolesRequiredFor(methodName)).toBeUndefined();
    },
  );
});
