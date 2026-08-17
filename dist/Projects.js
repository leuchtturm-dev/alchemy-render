import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import { paginate, RenderApi, } from "./Api/Api.js";
import { resourceClass, restProvider, unwrapEntity, unwrapRows, } from "./RestResource.js";
const ALLOW_ALL_IPS = [
    { cidrBlock: "0.0.0.0/0", description: "everywhere" },
];
export const Project = Resource.Resource("Render.Project");
export const Environment = Resource.Resource("Render.Environment");
export const EnvironmentResource = Resource.Resource("Render.EnvironmentResource");
export const ProjectProvider = () => restProvider(Project, {
    collection: "/projects",
    item: (id) => `/projects/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["projectId"],
    body: (_props, name, ownerId) => ({ name, ownerId, environments: [] }),
    updateBody: (_props, name) => ({ name }),
    attributes: (entity, fallback) => {
        const id = typeof entity.id === "string" ? entity.id : fallback.id;
        return {
            id,
            projectId: id,
            ownerId: fallback.ownerId,
            environmentIds: Array.isArray(entity.environmentIds)
                ? entity.environmentIds.filter((value) => typeof value === "string")
                : [],
            ...(typeof entity.name === "string" ? { name: entity.name } : {}),
        };
    },
});
const environmentAttributes = (entity, fallback) => {
    const id = typeof entity.id === "string" ? entity.id : fallback.id;
    return {
        id,
        environmentId: id,
        projectId: typeof entity.projectId === "string"
            ? entity.projectId
            : (fallback.props?.projectId ?? ""),
        protectedStatus: entity.protectedStatus === "protected" ? "protected" : "unprotected",
        networkIsolationEnabled: entity.networkIsolationEnabled === true,
        ...(typeof entity.name === "string" ? { name: entity.name } : {}),
    };
};
const listEnvironments = (api) => Effect.gen(function* () {
    const projects = yield* paginate((cursor) => api
        .request({
        method: "GET",
        path: "/projects",
        query: {
            ownerId: [api.ownerId],
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
        },
    })
        .pipe(Effect.map(unwrapRows)), { cursor: (row) => row.cursor, pageSize: 100 });
    const nested = yield* Effect.forEach(projects, ({ entity: project }) => {
        const projectId = typeof project.id === "string" ? project.id : undefined;
        if (!projectId)
            return Effect.succeed([]);
        return paginate((cursor) => api
            .request({
            method: "GET",
            path: "/environments",
            query: {
                projectId: [projectId],
                limit: 100,
                ...(cursor === undefined ? {} : { cursor }),
            },
        })
            .pipe(Effect.map(unwrapRows)), { cursor: (row) => row.cursor, pageSize: 100 }).pipe(Effect.map((rows) => rows.map(({ entity }) => environmentAttributes(entity, {
            id: typeof entity.id === "string" ? entity.id : projectId,
            ownerId: api.ownerId,
            props: { projectId },
        }))));
    }, { concurrency: 5 });
    return nested.flat();
});
export const EnvironmentProvider = () => restProvider(Environment, {
    collection: "/environments",
    item: (id) => `/environments/${encodeURIComponent(id)}`,
    ownerScoped: false,
    stables: ["environmentId", "projectId"],
    lookupQuery: (props) => ({ projectId: [props.projectId] }),
    list: listEnvironments,
    immutable: ["projectId"],
    body: (props, name) => ({
        name,
        projectId: props.projectId,
        protectedStatus: props.protectedStatus ?? "unprotected",
        networkIsolationEnabled: props.networkIsolationEnabled ?? false,
        ipAllowList: props.ipAllowList,
    }),
    updateBody: (props, name) => ({
        name,
        protectedStatus: props.protectedStatus ?? "unprotected",
        networkIsolationEnabled: props.networkIsolationEnabled ?? false,
        ipAllowList: props.ipAllowList ?? ALLOW_ALL_IPS,
    }),
    observe: (entity) => ({
        ...entity,
        ipAllowList: entity.ipAllowList ?? ALLOW_ALL_IPS,
    }),
    attributes: environmentAttributes,
});
const environmentContains = (entity, resourceId) => ["serviceIds", "databasesIds", "redisIds", "envGroupIds"].some((key) => Array.isArray(entity[key]) && entity[key].includes(resourceId));
export const EnvironmentResourceProvider = () => Provider.effect(resourceClass(EnvironmentResource), Effect.gen(function* () {
    const getApi = yield* RenderApi;
    const readMembership = (props, owned) => Effect.gen(function* () {
        const api = yield* getApi;
        const entity = unwrapEntity(yield* api.request({
            method: "GET",
            path: `/environments/${encodeURIComponent(props.environmentId)}`,
        }));
        if (!environmentContains(entity, props.resourceId))
            return undefined;
        const attributes = {
            id: props.resourceId,
            environmentId: props.environmentId,
            resourceId: props.resourceId,
        };
        return owned ? attributes : Unowned(attributes);
    }).pipe(Effect.catch((error) => error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error)));
    return EnvironmentResource.Provider.of({
        stables: ["id", "environmentId", "resourceId"],
        nuke: { skip: true },
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => readMembership(olds, output !== undefined),
        diff: ({ olds, news }) => Effect.succeed(!isResolved(news)
            ? undefined
            : olds.environmentId !== news.environmentId ||
                olds.resourceId !== news.resourceId
                ? { action: "replace" }
                : undefined),
        reconcile: Effect.fn(function* ({ news }) {
            const existing = yield* readMembership(news, true);
            if (!existing) {
                const api = yield* getApi;
                yield* api.request({
                    method: "POST",
                    path: `/environments/${encodeURIComponent(news.environmentId)}/resources`,
                    body: { resourceIds: [news.resourceId] },
                });
            }
            return {
                id: news.resourceId,
                environmentId: news.environmentId,
                resourceId: news.resourceId,
            };
        }),
        delete: Effect.fn(function* ({ output }) {
            const api = yield* getApi;
            yield* api
                .request({
                method: "DELETE",
                path: `/environments/${encodeURIComponent(output.environmentId)}/resources`,
                query: { resourceIds: [output.resourceId] },
            })
                .pipe(Effect.asVoid, Effect.catch((error) => error.isNotFound ? Effect.void : Effect.fail(error)));
        }),
    });
}));
//# sourceMappingURL=Projects.js.map