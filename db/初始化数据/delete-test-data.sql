delete from sys_user where id not in ('1','2','3','4');
delete from sys_user_friend where id != '1';
delete from sys_user_role where id not in ('1','2','3','4');


select * from sys_user where deleted != true
