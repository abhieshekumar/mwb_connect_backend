import { Request, Response } from 'express';
import autoBind from 'auto-bind';
import pg from 'pg';
import moment from 'moment';
import 'moment-timezone';
import { Conn } from '../db/conn';
import { constants } from '../utils/constants';
import User from '../models/user.model';
import Lesson from '../models/lesson.model';
import Subfield from '../models/subfield.model';

const conn = new Conn();
const pool = conn.pool;

export class AdminLessons {
  constructor() {
    autoBind(this);
  }

  async getLessons(request: Request, response: Response): Promise<void> {
    const client = await pool.connect();    
    try {
      await client.query('BEGIN');
      const getLessonsQuery = `SELECT ml.lesson_id, ml.mentor_id, ml.mentor_name, ml.student_id, u.name AS student_name, ml.subfield_name, ml.date_time, ml.meeting_url, ml.is_recurrent, ml.end_recurrence_date_time, ml.is_canceled FROM 
        (SELECT ul.id AS lesson_id, ul.mentor_id, u.name AS mentor_name, uls.student_id, s.name AS subfield_name, ul.date_time, ul.meeting_url, ul.is_recurrent, ul.end_recurrence_date_time, ul.is_canceled FROM users_lessons ul
          JOIN users u
            ON ul.mentor_id = u.id
          JOIN subfields s
            ON ul.subfield_id = s.id
          JOIN users_lessons_students uls
            ON ul.id = uls.lesson_id) ml
        JOIN users u
          ON ml.student_id = u.id
        ORDER BY ml.mentor_name`;
      const { rows }: pg.QueryResult = await client.query(getLessonsQuery);
      const group = rows.reduce((r, a) => {
        r[a.mentor_id] = [...r[a.mentor_id] || [], a];
        return r;
      }, {});

      const lessons: Array<Lesson> = [];
      for (const i in group) {
        const lessonItems = group[i];
        const students: Array<User> = [];
        let lesson: Lesson = {};
        for (const row of lessonItems) {
          const mentor: User = {
            id: row.mentor_id,
            name: row.mentor_name
          }
          const student: User = {
            id: row.student_id,
            name: row.student_name
          }
          students.push(student);
          const subfield: Subfield = {
            name: row.subfield_name
          }
          lesson = {
            id: row.lesson_id,
            mentor: mentor,
            students: students,
            subfield: subfield,
            dateTime: moment.utc(row.date_time).format(constants.DATE_TIME_FORMAT),
            meetingUrl: row.meeting_url,
            isRecurrent: row.is_recurrent ?? false,
            isCanceled: row.is_canceled ?? false
          };
          if (lesson.isRecurrent) {
            lesson.endRecurrenceDateTime = moment.utc(row.end_recurrence_date_time).format(constants.DATE_TIME_FORMAT);            
          }
        }
        lessons.push(lesson);     
      }
      response.status(200).json(lessons);
      await client.query('COMMIT');      
    } catch (error) {
      response.status(400).send(error);
      await client.query('ROLLBACK');      
    } finally {
      client.release();
    }
  }
}