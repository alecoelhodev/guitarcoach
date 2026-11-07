import type { UserSession } from '@thallesp/nestjs-better-auth';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

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
  it.each(['update', 'remove'] as const)(
    'restricts %s to the admin role',
    (methodName) => {
      expect(rolesRequiredFor(methodName)).toEqual(['admin']);
    },
  );

  it.each(['create', 'findAll', 'findOne'] as const)(
    'leaves %s open to any authenticated user',
    (methodName) => {
      expect(rolesRequiredFor(methodName)).toBeUndefined();
    },
  );
});

describe('TasksController.create', () => {
  const dto = { title: 'Riff A', difficulty: 'easy' as const };
  const session = (role?: string | null) =>
    ({ user: { id: 'u1', role } }) as unknown as UserSession;

  function build() {
    const service = { create: jest.fn(), createPrivate: jest.fn() };
    const controller = new TasksController(service as unknown as TasksService);
    return { service, controller };
  }

  it.each(['admin', 'user,admin'])(
    "adds an admin's task (role %s) to the shared library",
    async (role) => {
      const { service, controller } = build();
      await controller.create(dto, session(role));
      expect(service.create).toHaveBeenCalledWith(dto);
      expect(service.createPrivate).not.toHaveBeenCalled();
    },
  );

  it.each(['user', null])(
    "keeps a non-admin's task (role %s) private to them",
    async (role) => {
      const { service, controller } = build();
      await controller.create(dto, session(role));
      expect(service.createPrivate).toHaveBeenCalledWith('u1', dto);
      expect(service.create).not.toHaveBeenCalled();
    },
  );
});
