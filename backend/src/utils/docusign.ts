import { 
  ApiClient, 
  EnvelopesApi, 
  Document, 
  Signer, 
  SignHere, 
  Tabs, 
  EnvelopeDefinition, 
  Recipients, 
  RecipientViewRequest 
} from 'docusign-esign';
import fs from 'fs';
import path from 'path';

export class DocuSignService {
  private static dsApiClient = new ApiClient();
  private static accessToken: string | null = null;
  private static tokenExpiresAt = 0;

  /**
   * Check if DocuSign credentials are fully configured in the environment.
   */
  static isConfigured(): boolean {
    return !!(
      process.env.DOCUSIGN_INTEGRATION_KEY &&
      process.env.DOCUSIGN_USER_ID &&
      process.env.DOCUSIGN_ACCOUNT_ID &&
      process.env.DOCUSIGN_PRIVATE_KEY
    );
  }

  /**
   * Authenticate server-to-server with DocuSign via JWT OAuth.
   * Caches the token until it expires.
   */
  private static async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    console.log('Authenticating with DocuSign via JWT OAuth...');
    
    const baseAuthServer = process.env.DOCUSIGN_AUTH_SERVER || 'account-d.docusign.com';
    const basePath = process.env.DOCUSIGN_API_BASE_PATH || 'https://demo.docusign.net/restapi';
    
    this.dsApiClient.setBasePath(basePath);
    this.dsApiClient.setOAuthBasePath(baseAuthServer);

    // Format RSA Private Key (resolves literal newlines from env)
    const privateKey = (process.env.DOCUSIGN_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    try {
      const results = await this.dsApiClient.requestJWTUserToken(
        process.env.DOCUSIGN_INTEGRATION_KEY!,
        process.env.DOCUSIGN_USER_ID!,
        ['signature', 'impersonation'],
        Buffer.from(privateKey),
        3600 // 1 hour token lifetime
      );

      this.accessToken = results.body.access_token as string;
      // Expire token 1 minute early for safety
      this.tokenExpiresAt = Date.now() + (Number(results.body.expires_in) - 60) * 1000;
      
      this.dsApiClient.addDefaultHeader('Authorization', `Bearer ${this.accessToken}`);
      console.log('DocuSign JWT Authentication successful.');
      return this.accessToken;
    } catch (err: any) {
      console.error('DocuSign JWT Authentication failed:', err.response?.body || err.message);
      throw new Error(`DocuSign auth failed: ${err.message}`);
    }
  }

  /**
   * Send a document to DocuSign to create a signature envelope.
   * Configures the Dean as the embedded signer.
   */
  static async sendEnvelopeForSigning(params: {
    pdfPath: string;
    recipientName: string;
    recipientEmail: string;
    studentCode: string;
    companyName: string;
  }): Promise<string> {
    await this.authenticate();

    const { pdfPath, recipientName, recipientEmail, studentCode, companyName } = params;

    // 1. Read document bytes and convert to Base64
    const docBytes = fs.readFileSync(path.join(process.cwd(), pdfPath));
    const docBase64 = docBytes.toString('base64');

    // 2. Create Document object
    const doc: Document = {
      documentBase64: docBase64,
      name: 'Official Co-op Letter',
      fileExtension: 'pdf',
      documentId: '1'
    };

    // 3. Position the Signature Tab
    // Overlay signature at coordinates X: 100, Y: 620 on page 1 (A4 space)
    const signHere: SignHere = {
      documentId: '1',
      pageNumber: '1',
      recipientId: '1',
      xPosition: '100',
      yPosition: '620', // coordinates matching signature line in template
    };

    const signerTabs: Tabs = {
      signHereTabs: [signHere]
    };

    // 4. Create Signer Recipient
    const signer: Signer = {
      email: recipientEmail,
      name: recipientName,
      recipientId: '1',
      clientUserId: '1', // setting clientUserId turns them into an embedded signer
      tabs: signerTabs
    };

    const recipients: Recipients = {
      signers: [signer]
    };

    // 5. Build Envelope Definition
    const envDef: EnvelopeDefinition = {
      emailSubject: `RMUTTO Co-op Letter Signing Request: ${studentCode} - ${companyName}`,
      documents: [doc],
      recipients: recipients,
      status: 'sent' // Send it immediately
    };

    // 6. Submit to DocuSign API
    const envelopesApi = new EnvelopesApi(this.dsApiClient);
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID!;
    
    try {
      const results = await envelopesApi.createEnvelope(accountId, { envelopeDefinition: envDef });
      console.log(`Envelope created on DocuSign. ID: ${results.envelopeId}`);
      return results.envelopeId!;
    } catch (err: any) {
      console.error('Create Envelope Failed:', err.response?.body || err.message);
      throw new Error(`DocuSign create envelope failed: ${err.message}`);
    }
  }

  /**
   * Request an embedded signing URL for the signer.
   */
  static async getEnvelopeSigningUrl(envelopeId: string, params: {
    recipientName: string;
    recipientEmail: string;
    returnUrl: string;
  }): Promise<string> {
    await this.authenticate();

    const { recipientName, recipientEmail, returnUrl } = params;

    const viewRequest: RecipientViewRequest = {
      returnUrl: returnUrl,
      authenticationMethod: 'none',
      email: recipientEmail,
      userName: recipientName,
      recipientId: '1',
      clientUserId: '1', // MUST match clientUserId set during creation
    };

    const envelopesApi = new EnvelopesApi(this.dsApiClient);
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID!;

    try {
      const results = await envelopesApi.createRecipientView(accountId, envelopeId, {
        recipientViewRequest: viewRequest,
      });
      return results.url!;
    } catch (err: any) {
      console.error('Create Recipient View Failed:', err.response?.body || err.message);
      throw new Error(`DocuSign generate signing URL failed: ${err.message}`);
    }
  }

  /**
   * Download the signed/completed document from DocuSign.
   */
  static async downloadSignedDocument(envelopeId: string, destPath: string): Promise<void> {
    await this.authenticate();

    const envelopesApi = new EnvelopesApi(this.dsApiClient);
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID!;

    try {
      // Get the document (documentId: '1' is our letter, pass empty opts object {} as 4th arg)
      const results = await envelopesApi.getDocument(accountId, envelopeId, '1', {});
      const absoluteDest = path.join(process.cwd(), destPath);
      
      // Save binary file
      fs.writeFileSync(absoluteDest, Buffer.from(results, 'binary'));
      console.log(`Completed PDF downloaded from DocuSign and saved to: ${destPath}`);
    } catch (err: any) {
      console.error('Download Signed Document Failed:', err.response?.body || err.message);
      throw new Error(`DocuSign download PDF failed: ${err.message}`);
    }
  }
}
