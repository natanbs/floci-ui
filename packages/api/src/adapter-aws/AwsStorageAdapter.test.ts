import {describe, expect, test} from 'bun:test'
import {ListObjectsV2Command, type S3Client} from '@aws-sdk/client-s3'
import {AwsStorageAdapter} from './AwsStorageAdapter'

type SendResult = Record<string, unknown>

/** Minimal S3Client stub that answers sends with canned payloads in order. */
function stubS3(responses: SendResult[]) {
    const sent: object[] = []
    let index = 0
    const client = {
        async send(command: object) {
            sent.push(command)
            return responses[Math.min(index++, responses.length - 1)]
        },
    } as unknown as S3Client
    return {client, sent}
}

const listPayload = {
    CommonPrefixes: [{Prefix: 'docs/'}],
    Contents: [
        {
            Key: 'docs/report.txt',
            Size: 12,
            LastModified: new Date('2026-09-01T10:00:00.000Z'),
            ETag: '"abc123"',
            StorageClass: 'GLACIER',
        },
        {
            Key: 'photo.png',
            Size: 2048,
            LastModified: new Date('2026-09-02T10:00:00.000Z'),
            ETag: '"def456"',
            // StorageClass omitted on purpose: S3 omits it for STANDARD objects.
        },
    ],
    IsTruncated: false,
}

describe('AwsStorageAdapter object listing', () => {
    test('maps folders first and preserves full keys', async () => {
        const {client, sent} = stubS3([listPayload])
        const result = await new AwsStorageAdapter(client).listObjects('floci-app-bucket')

        expect(sent[0]).toBeInstanceOf(ListObjectsV2Command)
        expect(result.prefix).toBe('')
        expect(result.objects.map((o) => o.key)).toEqual(['docs/', 'docs/report.txt', 'photo.png'])

        const folder = result.objects[0]
        expect(folder?.type).toBe('folder')
        expect(folder?.name).toBe('docs')
        expect(folder?.size).toBeNull()
        expect(folder?.lastModified).toBeNull()
    })

    test('maps object size and last-modified instant', async () => {
        const {client} = stubS3([listPayload])
        const result = await new AwsStorageAdapter(client).listObjects('floci-app-bucket')

        const photo = result.objects.find((o) => o.key === 'photo.png')
        expect(photo?.type).toBe('object')
        expect(photo?.size).toBe(2048)
        expect(photo?.lastModified).toBe('2026-09-02T10:00:00.000Z')
    })

    test('defaults an omitted storage class to STANDARD', async () => {
        const {client} = stubS3([listPayload])
        const result = await new AwsStorageAdapter(client).listObjects('floci-app-bucket')

        const photo = result.objects.find((o) => o.key === 'photo.png')
        expect(photo?.metadata.storageClass).toBe('STANDARD')
    })

    test('keeps an explicit storage class untouched', async () => {
        const {client} = stubS3([listPayload])
        const result = await new AwsStorageAdapter(client).listObjects('floci-app-bucket')

        const report = result.objects.find((o) => o.key === 'docs/report.txt')
        expect(report?.metadata.storageClass).toBe('GLACIER')
    })

    test('strips surrounding quotes from etags', async () => {
        const {client} = stubS3([listPayload])
        const result = await new AwsStorageAdapter(client).listObjects('floci-app-bucket')

        const report = result.objects.find((o) => o.key === 'docs/report.txt')
        expect(report?.metadata.etag).toBe('abc123')
    })
})
