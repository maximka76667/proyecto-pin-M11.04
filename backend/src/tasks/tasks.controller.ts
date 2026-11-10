import { BadRequestException, Body, Controller, Get, Param, Post, Query, Patch, Delete } from '@nestjs/common';
import { CreateTaskDto } from './dto/create-task.dto';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';
import { CurrentUser } from '../common/current-user.decorator';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskAssignmentDto } from './dto/create-task-assignment.dto';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto';


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
