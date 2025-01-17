import {
  UpdateTaskDTO,
  CreateTaskDTO,
  TaskOutputDTO,
} from "../model/dto/index";
import generateID from "../utils/generateID";
import ITaskRepository from "./ITaskRepository";
import { getDB } from "./db";
import { ErrorMessages } from "../exceptions";
import { TaskStates } from "../model/enum/TaskStates";

export class TaskRepository implements ITaskRepository {
  _getDB = async () => await getDB();

  /** Convert `?`s into $1, $2, $3, etc. */
  private async _preparePostgresSqlQuery(sql: string): Promise<string> {
    let i = 1;
    return sql.replace(/\?/g, () => `$${i++}`);
  }

  public async createMany(createDTOs: Array<CreateTaskDTO>) {
    //Map DTOs to INSERT values (node-postgres format)
    const insertValuesTasks: Array<string | Date | undefined> = [];
    const insertValuesUsers: Array<string | undefined> = [];
    createDTOs.forEach((dto) => {
      //TODO: Do we need to check if owner already exists as a user?
      const ownerId = generateID();
      insertValuesUsers.push(
        ownerId,
        dto.task_owner,
        dto.email,
        dto.company_name
      );
      insertValuesTasks.push(
        ownerId,
        dto.task_date,
        dto.task_description,
        dto.task_status
      );
    });

    //Insert all Users
    console.log("[🗄️ DB] BEGIN query createMany.users");
    const db = await this._getDB();
    const sqlUsers = await this._preparePostgresSqlQuery(
      `INSERT INTO users (_id, full_name, email, company_name)
      VALUES ${createDTOs.map(() => "(?, ?, ?, ?)").join(",")};`
    );
    await db.query(sqlUsers, insertValuesUsers).catch((err) => {
      throw err;
    });
    console.log("[🗄️ DB] END query createMany.users");

    //Insert all Tasks
    console.log("[🗄️ DB] BEGIN query createMany.tasks");
    const sqlTasks = await this._preparePostgresSqlQuery(
      `INSERT INTO tasks (owner_id, task_date, description, status)
      VALUES ${createDTOs.map(() => `(?, ?, ?, ?)`).join(",")};`
    );
    await db.query(sqlTasks, insertValuesTasks).catch((err) => {
      throw err;
    });
    console.log("[🗄️ DB] END query createMany.tasks");

    //TODO: We could return Task IDs here, but because the CSV has 1000 entries it likely won't be necessary.
  }

  public async getAll() {
    //TODO: Paging? Returning 1000 entries is a bit large
    console.log("[🗄️ DB] BEGIN query getAll");
    const db = await this._getDB();
    const result = await db.query(
      `SELECT
        tasks._id AS task_id,
        users.full_name AS owner_full_name,
        users.email AS owner_email,
        users.company_name AS owner_company_name,
        tasks.owner_id,
        tasks.status,
        tasks.task_date,
        tasks.description
      FROM tasks
      LEFT JOIN users ON tasks.owner_id=users._id;`
    );
    console.log("[🗄️ DB] END query getAll");
    return result.rows;
  }

  public async getById(id: string) {
    console.log("[🗄️ DB] BEGIN query getById");
    const db = await this._getDB();
    const result = await db.query(
      `SELECT
        tasks._id AS task_id,
        users.full_name AS owner_full_name,
        users.email AS owner_email,
        users.company_name AS owner_company_name,
        tasks.owner_id,
        tasks.status,
        tasks.task_date,
        tasks.description
      FROM tasks
      LEFT JOIN users ON tasks.owner_id=users._id
      WHERE tasks._id = $1;`,
      [id]
    );
    console.log("[🗄️ DB] END query getById");
    if (result.rowCount === 0) {
      throw Error(ErrorMessages.taskIdNotFound);
    }
    return this._mapDbToOutputDTO(result.rows[0]);
  }

  public async update(id: string, updateTaskDTO: UpdateTaskDTO) {
    const db = await this._getDB();

    const existing = await this.getById(id);
    if (existing.status != TaskStates.IN_REVIEW) {
      throw Error(ErrorMessages.taskStatusCannotBeEdited);
    }
    console.log("[🗄️ DB] BEGIN query update");
    const updateResult = await db.query(
      `UPDATE tasks
      SET status = $1
      WHERE tasks._id = $2;`,
      [updateTaskDTO.task_status, id]
    );
    console.log("[🗄️ DB] END query update");

    if (updateResult.rowCount === 0) {
      throw Error(ErrorMessages.taskUpdateZeroAffectedRows);
    }
  }
}
