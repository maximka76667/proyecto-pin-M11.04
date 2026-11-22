import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateTaskDto } from './dto/create-task.dto';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';
import { CurrentUser } from '../common/current-user.decorator';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskAssignmentDto } from './dto/create-task-assignment.dto';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto';
import { TaskAvailabilityQueryDto } from './dto/task-availability-query.dto';
import { SetTaskPreferencesDto } from './dto/set-task-preferences.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly taskSwapsService: TaskSwapsService,
  ) {}

  // --- Intercambios (swap). Declaradas antes que las rutas ':id' para que no las capturen. ---

  @Get('swap-requests/candidates')
  swapCandidates(
    @Query('apartment_id') apartmentId: string,
    @CurrentUser() userId: string,
  ) {
    return this.taskSwapsService.listSwappableTasks(apartmentId, userId);
  }

  @Get('swap-requests')
  listSwaps(
    @Query('apartment_id') apartmentId: string,
    @CurrentUser() userId: string,
  ) {
    return this.taskSwapsService.listMySwaps(apartmentId, userId);
  }

  @Post('swap-requests')
  createSwap(
    @Body() dto: CreateSwapRequestDto,
    @CurrentUser() userId: string,
  ) {
    return this.taskSwapsService.createSwapRequest(
      dto.from_assignment_id,
      dto.to_assignment_id,
      userId,
    );
  }

  @Post('swap-requests/:id/accept')
  acceptSwap(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.taskSwapsService.acceptSwapRequest(id, userId);
  }

  @Post('swap-requests/:id/reject')
  rejectSwap(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.taskSwapsService.rejectSwapRequest(id, userId);
  }

  @Delete('swap-requests/:id')
  cancelSwap(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.taskSwapsService.cancelSwapRequest(id, userId);
  }

  @Post()
  create(@Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(createTaskDto);
  }

  // Rutas de preferencias de tareas (UT1020). Deben ir antes de las rutas con :id
  @Get('preferences')
  getPreferences(
    @CurrentUser() userId: string,
    @Query('apartment_id') apartmentId?: string,
  ) {
    return this.tasksService.getUserPreferences(apartmentId, userId);
  }

  @Put('preferences')
  setPreferences(
    @Body() dto: SetTaskPreferencesDto,
    @CurrentUser() userId: string,
  ) {
    return this.tasksService.setUserPreferences(dto, userId);
  }

  @Post('preferences')
  createPreferences(
    @Body() dto: SetTaskPreferencesDto,
    @CurrentUser() userId: string,
  ) {
    return this.tasksService.setUserPreferences(dto, userId);
  }

  @Delete('preferences/:taskId')
  removePreference(
    @Param('taskId') taskId: string,
    @CurrentUser() userId: string,
  ) {
    return this.tasksService.removeUserPreference(taskId, userId);
  }

  @Post(':id/assignments')
  createAssignment(
    @Param('id') taskId: string,
    @Body() assignmentDto: CreateTaskAssignmentDto,
    @CurrentUser() currentUserId: string
  ) {
    return this.tasksService.createAssignment(
      taskId,
      assignmentDto,
      currentUserId
    );
  }

  // Quién del hogar está libre para la tarea en ese día y hora (diálogo "Asignar tarea")
  @Get(':id/availability')
  membersAvailability(
    @Param('id') taskId: string,
    @Query() query: TaskAvailabilityQueryDto,
    @CurrentUser() currentUserId: string,
  ) {
    if (!UUID_PATTERN.test(taskId)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return this.tasksService.membersAvailability(taskId, query, currentUserId);
  }

  @Delete('assignments/:id')
  removeAssignment(
    @Param('id') assignmentId: string,
    @CurrentUser() userId: string,
  ) {
    return this.tasksService.removeAssignment(assignmentId, userId);
  }

  @Get()
  findAll(@Query('apartment_id') apartmentId?: string) {
    return this.tasksService.findAll(apartmentId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }

    return this.tasksService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @CurrentUser() userId: string,
  ) {
    return this.tasksService.update(id, updateTaskDto, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.tasksService.remove(id, userId);
  }
}
