import { stringInterpolator } from '@graphql-mesh/string-interpolation';

export const removeTypename = (obj: object): object => {
    if (Array.isArray(obj)) return obj.map(removeTypename);
    if (typeof obj !== 'object' || obj === null) return obj;

    return Object.fromEntries(
        Object.entries(obj)
            .filter(([key]) => key !== '__typename')
            .map(([key, val]) => [key, removeTypename(val)]),
    );
};

export const findParentPath = (path: any): any => {
    if (path?.prev && Number.isInteger(path.key)) {
        return findParentPath(path.prev);
    }

    return path;
};

export const cleanPath = (path: any): any => {
    if (path && typeof path === 'object') {
        if (path.prev && typeof path.prev === 'object' && Number.isInteger(path.prev.key)) {
            path.prev = cleanPath(path.prev.prev);
        }
    }

    return path;
};

export const evaluate = (value?: any): any => {
    if (typeof value === 'string') {
        const result = stringInterpolator.parse(value, { env: process.env });

        if (result === '') {
            return undefined;
        } else if (result === 'null') {
            return null;
        } else if (result === 'true' || result === 'false') {
            return result === 'true';
        } else if (!isNaN(Number(result))) {
            return Number(result);
        }

        return result;
    }

    return value;
};
