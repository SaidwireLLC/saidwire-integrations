import { randomBytes } from 'crypto';

export interface MultipartFile {
	fieldName: string;
	fileName: string;
	mimeType: string;
	data: Buffer;
}

export interface MultipartBody {
	body: Buffer;
	contentType: string;
}

const CRLF = '\r\n';

function quote(value: string): string {
	// RFC 7578: escape quotes and strip line breaks in header parameters
	return value.replace(/[\r\n]+/g, ' ').replace(/"/g, '%22');
}

/**
 * Builds a multipart/form-data body without third-party packages, so the node
 * has no runtime dependencies (a requirement for verified community nodes).
 */
export function buildMultipart(
	fields: Array<[string, string]>,
	file: MultipartFile,
	boundary = `----n8nSaidwire${randomBytes(12).toString('hex')}`,
): MultipartBody {
	const chunks: Buffer[] = [];
	for (const [name, value] of fields) {
		chunks.push(
			Buffer.from(
				`--${boundary}${CRLF}Content-Disposition: form-data; name="${quote(name)}"${CRLF}${CRLF}${value}${CRLF}`,
				'utf8',
			),
		);
	}
	chunks.push(
		Buffer.from(
			`--${boundary}${CRLF}Content-Disposition: form-data; name="${quote(file.fieldName)}"; filename="${quote(
				file.fileName,
			)}"${CRLF}Content-Type: ${file.mimeType}${CRLF}${CRLF}`,
			'utf8',
		),
	);
	chunks.push(file.data);
	chunks.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8'));
	return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
