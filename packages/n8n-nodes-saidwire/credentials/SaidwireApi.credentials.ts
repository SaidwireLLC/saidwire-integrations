import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SaidwireApi implements ICredentialType {
	name = 'saidwireApi';

	displayName = 'Saidwire API';

	icon: Icon = { light: 'file:saidwire.svg', dark: 'file:saidwire.dark.svg' };

	documentationUrl = 'https://saidwire.com/docs/api';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'sk_live_...',
			description: 'Your Saidwire API key. Get one at https://saidwire.com/dev.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.saidwire.com/v1',
			description: 'Leave as is unless Saidwire support gave you a different endpoint',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/models',
			method: 'GET',
		},
	};
}
