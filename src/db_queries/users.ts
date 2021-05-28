import { Request, Response } from 'express';
import autoBind from 'auto-bind';
import pg from 'pg';
import { Conn } from '../db/conn';
import { Auth } from './auth';
import User from '../models/user.model';
import Field from '../models/field.model';
import Subfield from '../models/subfield.model';
import Skill from '../models/skill.model';

const conn: Conn = new Conn();
const pool = conn.pool;
const auth: Auth = new Auth();

export class Users {
  constructor() {
    autoBind(this);
  }

  async getUsers(request: Request, response: Response): Promise<void> {
    try {
      const getQuery = 'SELECT * FROM users ORDER BY id ASC';
      const { rows }: pg.QueryResult = await pool.query(getQuery);
      response.status(200).json(rows);
    } catch (error) {
      response.status(400).send(error);
    }   
  }

  async getUserById(request: Request, response: Response): Promise<void> {
    const id: string = request.params.id;
    try {
      const getUserQuery = `SELECT u.id, u.name, u.email, o.name AS organization, f.id AS field_id, f.name AS field_name, u.is_mentor
        FROM users u
        INNER JOIN fields f
        ON u.field_id = f.id
        INNER JOIN organizations o
        ON u.organization_id = o.id
        WHERE u.id = $1`;
      const { rows }: pg.QueryResult = await pool.query(getUserQuery, [id]);
      const field: Field = {
        id: rows[0].field_id,
        name: rows[0].field_name,
        subfields: await this.getUserSubfields(id)
      }
      const user: User = {
        id: rows[0].id,
        name: rows[0].name,
        email: rows[0].email,
        organization: rows[0].organization,
        field: field,
        isMentor: rows[0].is_mentor,
      }

      response.status(200).json(user);
    } catch (error) {
      response.status(400).send(error);
    }
  }

  async getUserSubfields(userId: string): Promise<Array<Subfield>> {
    const getSubfieldsQuery = `SELECT s.id, s.name
      FROM subfields s
      INNER JOIN users_subfields us
      ON us.subfield_id = s.id
      WHERE us.user_id = $1
      ORDER BY us.subfield_index`;
    const { rows }: pg.QueryResult = await pool.query(getSubfieldsQuery, [userId]);
    const subfields: Array<Subfield> = [];
    for (const row of rows) {
      const skills: Array<Skill> = await this.getUserSkills(userId, row.id);
      const subfield: Subfield = {
        id: row.id,
        name: row.name,
        skills: skills
      };
      subfields.push(subfield);
    }
    return subfields;    
  }

  async getUserSkills(userId: string, subfieldId: string): Promise<Array<Skill>> {
    const getSkillsQuery = `SELECT s.id, s.name
      FROM skills s
      INNER JOIN users_skills us
      ON us.skill_id = s.id
      WHERE us.user_id = $1 AND us.subfield_id = $2
      ORDER BY us.skill_index`;
    const { rows }: pg.QueryResult = await pool.query(getSkillsQuery , [userId, subfieldId]);
    const skills: Array<Skill> = [];
    rows.forEach(function (row) {
      const skill: Skill = {
        id: row.id,
        name: row.name
      };
      skills.push(skill);
    });
    return skills;    
  }  

  async updateUser(request: Request, response: Response): Promise<void> {
    const id: string = request.params.id;
    const { name, email, field }: User = request.body
    try {
      const updateQuery = 'UPDATE users SET name = $1, email = $2, field_id = $3 WHERE id = $4';
      await pool.query(updateQuery, [name, email, field?.id, id]);
      await this.updateUserSubfields(id, field?.subfields as Array<Subfield>);
      response.status(200).send(`User modified with ID: ${id}`);
    } catch (error) {
      response.status(400).send(error);
    }
  }

  async deleteUserSubfields(userId: string): Promise<void> {
    const deleteSubfieldsQuery = `DELETE FROM users_subfields
      WHERE user_id = $1`;
    await pool.query(deleteSubfieldsQuery, [userId]);
  }

  async updateUserSubfields(userId: string, subfields: Array<Subfield>): Promise<void> {
    this.deleteUserSubfields(userId);
    for (let i = 0; i < subfields.length; i++) {
      const insertSubfieldQuery = `INSERT INTO users_subfields (user_id, subfield_index, subfield_id)
        VALUES ($1, $2, $3)`;
      await pool.query(insertSubfieldQuery, [userId, i+1, subfields[i].id]); 
      if (subfields[i].skills != null && (subfields[i].skills as Array<Skill>).length > 0) {
        await this.updateUserSkills(userId, subfields[i].id, subfields[i].skills as Array<Skill>);
      } else {
        await this.deleteUserSkills(userId, subfields[i].id);
      }
    }
  }

  async deleteUserSkills(userId: string, subfieldId: string): Promise<void> {
    const deleteSkillsQuery = `DELETE FROM users_skills
      WHERE user_id = $1 AND subfield_id = $2`;
    await pool.query(deleteSkillsQuery, [userId, subfieldId]);    
  }
  
  async updateUserSkills(userId: string, subfieldId: string, skills: Array<Skill>): Promise<void> {
    await this.deleteUserSkills(userId, subfieldId);
    for (let i = 0; i < skills.length; i++) {
      const insertSkillQuery = `INSERT INTO users_skills (user_id, subfield_id, skill_index, skill_id)
        VALUES ($1, $2, $3, $4)`;
      await pool.query(insertSkillQuery, [userId, subfieldId, i+1, skills[i].id]);      
    }
  }    

  async deleteUser(request: Request, response: Response): Promise<void> {
    const id: string = request.params.id;
    try {
      const deleteQuery = 'DELETE FROM users WHERE id = $1';
      await pool.query(deleteQuery, [id]);
      await auth.revokeRefreshToken(id);
      response.status(200).send(`User deleted with ID: ${id}`);
    } catch (error) {
      response.status(400).send(error);
    }    
  }
}

