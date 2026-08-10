import { query } from '../config/database';
import { DocumentTemplate } from '../types';

export class DocumentTemplateModel {
  /**
   * Find a document template by its ID.
   */
  static async findById(templateId: number): Promise<DocumentTemplate | null> {
    const res = await query(
      `SELECT template_id, name, file_path, type 
       FROM document_templates 
       WHERE template_id = $1`,
      [templateId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as DocumentTemplate;
  }

  /**
   * Create a new document template.
   */
  static async create(templateData: {
    name: string;
    file_path: string;
    type: string;
  }): Promise<DocumentTemplate> {
    const res = await query(
      `INSERT INTO document_templates (name, file_path, type)
       VALUES ($1, $2, $3)
       RETURNING template_id, name, file_path, type`,
      [templateData.name, templateData.file_path, templateData.type]
    );
    return res.rows[0] as DocumentTemplate;
  }

  /**
   * Get all document templates.
   */
  static async findAll(): Promise<DocumentTemplate[]> {
    const res = await query(
      `SELECT template_id, name, file_path, type 
       FROM document_templates 
       ORDER BY template_id ASC`
    );
    return res.rows as DocumentTemplate[];
  }
}
